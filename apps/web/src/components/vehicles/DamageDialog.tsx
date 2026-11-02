import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
    DAMAGE_DESCRIPTION_MAX,
    DAMAGE_PHOTOS_MAX,
    DAMAGE_SEVERITIES,
    DAMAGE_SEVERITY_LABELS,
    berlinTodayIso,
    type Damage,
    type DamageInput,
    type DamageSeverity,
} from "@fleet-live/shared";

import { ApiError } from "../../api/client";
import {
    addDamagePhoto,
    damagePhotoUrl,
    deleteDamagePhoto,
    reportDamage,
    updateDamage,
} from "../../api/damages";
import { shrinkPhoto } from "../../utils/shrinkPhoto";
import { Button } from "../ui/Button/Button";
import { SwapLabel } from "../ui/Button/SwapLabel";
import { Checkbox } from "../ui/Checkbox/Checkbox";
import { FieldError } from "../ui/FieldError/FieldError";
import { fieldAria } from "../ui/FieldError/fieldAria";
import { Input } from "../ui/Input/Input";
import { Textarea } from "../ui/Input/Textarea";
import { Modal } from "../ui/Modal/Modal";
import { PlacePickerMap, type PickedPoint } from "./PlacePickerMap";
import formStyles from "./VehicleForm.module.scss";
import styles from "./workshop.module.scss";

type Field =
    | "occurred_on"
    | "occurred_time"
    | "description"
    | "severity"
    | "drivable"
    | "latitude"
    | "photos"
    | "form";

export type DamageTarget = {
    vehicleId: number;
    licensePlate: string;
    /** On a trip right now: „Nicht fahrbereit“ stops it there. */
    driving?: boolean;
    /** The current driver, kept on the damage. */
    driverName?: string | null;
    /** The last reported position, where the map opens. */
    position?: PickedPoint | null;
};

interface DamageDialogProps {
    /** Report a new damage on this vehicle. */
    target: DamageTarget | null;
    /** Or edit this open damage. */
    damage?: Damage | null;
    licensePlate: string;
    onClose: () => void;
    onSaved: (damage: Damage, message: string) => void;
    /** Edit mode: close the damage without a workshop (the parent asks first). */
    onCloseWithoutWorkshop?: (damage: Damage) => void;
    /**
     * Report mode: offers „Danach Werkstatt-Termin planen“; when ticked this
     * is called with the new damage instead of `onSaved`.
     */
    onPlan?: (damage: Damage, message: string) => void;
}

/** „Schaden melden“, or a reported damage to correct. */
export const DamageDialog = ({
    target,
    damage = null,
    licensePlate,
    onClose,
    onSaved,
    onCloseWithoutWorkshop,
    onPlan,
}: DamageDialogProps) => {
    const open = target !== null || damage !== null;

    return (
        <Modal open={open} onClose={onClose} title={damage ? "Schaden" : "Schaden melden"} guardUnsaved>
            {open && (
                <DamageForm
                    key={damage ? `d${damage.id}` : `t${target?.vehicleId}`}
                    target={target}
                    damage={damage}
                    licensePlate={licensePlate}
                    onCancel={onClose}
                    onSaved={onSaved}
                    onCloseWithoutWorkshop={onCloseWithoutWorkshop}
                    onPlan={damage ? undefined : onPlan}
                />
            )}
        </Modal>
    );
};

const clockNow = () =>
    new Intl.DateTimeFormat("de-DE", {
        timeZone: "Europe/Berlin",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date());

const degrees = (value: number) => value.toFixed(4).replace(".", ",");

/** „50,9582° N · 6,9287° O“ */
const placeText = (point: PickedPoint) =>
    `${degrees(Math.abs(point.latitude))}° ${point.latitude >= 0 ? "N" : "S"} · ${degrees(Math.abs(point.longitude))}° ${point.longitude >= 0 ? "O" : "W"}`;

type NewPhoto = { key: number; blob: Blob; url: string };

const DamageForm = ({
    target,
    damage,
    licensePlate,
    onCancel,
    onSaved,
    onCloseWithoutWorkshop,
    onPlan,
}: {
    target: DamageTarget | null;
    damage: Damage | null;
    licensePlate: string;
    onCancel: () => void;
    onSaved: DamageDialogProps["onSaved"];
    onCloseWithoutWorkshop?: (damage: Damage) => void;
    onPlan?: DamageDialogProps["onPlan"];
}) => {
    const fieldId = useId();
    const today = berlinTodayIso();
    const driving = !damage && target?.driving === true;
    const [occurredOn, setOccurredOn] = useState(damage?.occurred_on ?? today);
    const [occurredTime, setOccurredTime] = useState(
        damage ? (damage.occurred_time ?? "") : clockNow(),
    );
    const [description, setDescription] = useState(damage?.description ?? "");
    const [severity, setSeverity] = useState<DamageSeverity>(damage?.severity ?? "MINOR");
    const [drivable, setDrivable] = useState(damage?.drivable ?? true);
    const [point, setPoint] = useState<PickedPoint | null>(() => {
        if (damage) {
            return damage.latitude !== null && damage.longitude !== null
                ? { latitude: damage.latitude, longitude: damage.longitude }
                : null;
        }
        return target?.position ?? null;
    });
    // The point is still the last report until someone clicks the map.
    const [moved, setMoved] = useState(damage !== null);
    const [keptPhotos, setKeptPhotos] = useState<number[]>(damage?.photo_ids ?? []);
    const [newPhotos, setNewPhotos] = useState<NewPhoto[]>([]);
    const photoKey = useRef(0);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    // Planning follows „Fahrbereit?“ (a vehicle off the road needs the
    // workshop) until the box is ticked or cleared by hand.
    const [planChoice, setPlanChoice] = useState<boolean | null>(null);
    const planAfter = onPlan !== undefined && (planChoice ?? !drivable);
    const photoCount = keptPhotos.length + newPhotos.length;
    const driverName = damage ? damage.driver_name : (target?.driverName ?? null);

    // The previews are object URLs; give them back when the form goes away.
    const previews = useRef(newPhotos);
    useEffect(() => {
        previews.current = newPhotos;
    }, [newPhotos]);
    useEffect(() => () => previews.current.forEach((photo) => URL.revokeObjectURL(photo.url)), []);

    const clear = (field: Field) =>
        setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));

    const choosePhotos = async (event: ChangeEvent<HTMLInputElement>) => {
        const files = [...(event.target.files ?? [])];
        event.target.value = "";
        clear("photos");
        const room = DAMAGE_PHOTOS_MAX - photoCount;
        if (files.length > room) {
            setErrors((current) => ({
                ...current,
                photos: `Höchstens ${DAMAGE_PHOTOS_MAX} Fotos; die ersten ${room} sind dabei.`,
            }));
        }
        const added: NewPhoto[] = [];
        for (const file of files.slice(0, Math.max(0, room))) {
            try {
                const blob = await shrinkPhoto(file);
                photoKey.current += 1;
                added.push({ key: photoKey.current, blob, url: URL.createObjectURL(blob) });
            } catch {
                setErrors((current) => ({ ...current, photos: `„${file.name}“ ist kein lesbares Foto.` }));
            }
        }
        setNewPhotos((current) => [...current, ...added]);
    };

    const removeNewPhoto = (key: number) =>
        setNewPhotos((current) => {
            const gone = current.find((photo) => photo.key === key);
            if (gone) {
                URL.revokeObjectURL(gone.url);
            }
            return current.filter((photo) => photo.key !== key);
        });

    /** Photos after the damage is saved; a refused photo does not undo the report. */
    const savePhotos = async (saved: Damage): Promise<{ damage: Damage; failed: string | null }> => {
        let current = saved;
        let failed: string | null = null;
        for (const photoId of saved.photo_ids.filter((id) => !keptPhotos.includes(id))) {
            try {
                current = (await deleteDamagePhoto(saved.id, photoId)).data;
            } catch (caught) {
                failed = caught instanceof Error ? caught.message : "Foto nicht entfernt.";
            }
        }
        for (const photo of newPhotos) {
            try {
                current = (await addDamagePhoto(saved.id, photo.blob)).data;
            } catch (caught) {
                failed = caught instanceof Error ? caught.message : "Foto nicht gespeichert.";
            }
        }
        return { damage: current, failed };
    };

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        if (description.trim() === "") {
            setErrors({ description: "Was ist passiert? fehlt." });
            return;
        }

        setIsSubmitting(true);
        setErrors({});
        const input: DamageInput = {
            occurred_on: occurredOn,
            description: description.trim(),
            severity,
            drivable,
            occurred_time: occurredTime === "" ? null : occurredTime,
            latitude: point?.latitude ?? null,
            longitude: point?.longitude ?? null,
        };

        try {
            if (damage) {
                const { data } = await updateDamage(damage.id, input);
                const { damage: withPhotos, failed } = await savePhotos(data);
                onSaved(withPhotos, failed ? `Schaden gespeichert. ${failed}` : "Schaden gespeichert.");
            } else if (target) {
                const { data } = await reportDamage(target.vehicleId, input);
                const { damage: withPhotos, failed } = await savePhotos(data);
                const said = drivable
                    ? `Schaden an ${licensePlate} gemeldet.`
                    : driving
                      ? `Panne an ${licensePlate} gemeldet. Die Fahrt ist beendet, es ist nicht fahrbereit.`
                      : `Schaden an ${licensePlate} gemeldet. Es ist nicht fahrbereit.`;
                const message = failed ? `${said} ${failed}` : said;
                if (planAfter && onPlan) {
                    onPlan(withPhotos, message);
                } else {
                    onSaved(withPhotos, message);
                }
            }
        } catch (caught) {
            if (caught instanceof ApiError) {
                const fields = (caught.fields ?? {}) as Partial<Record<Field, string>>;
                const known = Object.keys(fields).length > 0;
                setErrors({ ...fields, form: known ? undefined : caught.message });
            } else {
                setErrors({ form: "Der Schaden wurde nicht gespeichert." });
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const context = driving
        ? `${licensePlate} · auf Fahrt${target?.driverName ? ` mit ${target.driverName}` : ""}`
        : licensePlate;

    return (
        <form className={formStyles.form} onSubmit={handleSubmit} noValidate>
            <p className={styles.context}>{context}</p>

            <div className={formStyles.field}>
                <label htmlFor={`${fieldId}-what`}>Was ist passiert?</label>
                <Textarea
                    id={`${fieldId}-what`}
                    data-autofocus
                    maxLength={DAMAGE_DESCRIPTION_MAX}
                    placeholder={
                        driving
                            ? "z. B. Reifen geplatzt, Motor aus"
                            : "z. B. Delle in der Heckklappe, Spiegel rechts abgerissen"
                    }
                    value={description}
                    onChange={(event) => {
                        setDescription(event.target.value);
                        clear("description");
                    }}
                    {...fieldAria(`${fieldId}-what`, errors.description)}
                />
                <FieldError fieldId={`${fieldId}-what`} className={formStyles.error}>
                    {errors.description}
                </FieldError>
            </div>

            <fieldset className={styles.reasons}>
                <legend>Schwere</legend>
                <div className={styles.reasonRow}>
                    {DAMAGE_SEVERITIES.map((value) => (
                        <label key={value} className={styles.reason} data-checked={severity === value || undefined}>
                            <input
                                type="radio"
                                name={`${fieldId}-severity`}
                                checked={severity === value}
                                onChange={() => setSeverity(value)}
                            />
                            {DAMAGE_SEVERITY_LABELS[value]}
                        </label>
                    ))}
                </div>
            </fieldset>

            <fieldset className={styles.reasons}>
                <legend>Fahrbereit?</legend>
                <div className={styles.reasonRow}>
                    {[true, false].map((value) => (
                        <label
                            key={String(value)}
                            className={styles.reason}
                            data-checked={drivable === value || undefined}
                        >
                            <input
                                type="radio"
                                name={`${fieldId}-drivable`}
                                checked={drivable === value}
                                onChange={() => setDrivable(value)}
                            />
                            {value ? "Ja" : "Nein"}
                        </label>
                    ))}
                </div>
                {drivable ? (
                    <p className={formStyles.hint}>Das Fahrzeug bleibt einsatzbereit.</p>
                ) : driving ? (
                    <div className={styles.farBox}>
                        <p>
                            Panne unterwegs: {licensePlate} hält an, die laufende Fahrt endet hier. Danach hat es
                            keinen Fahrer, bis der Schaden behoben ist.
                        </p>
                    </div>
                ) : (
                    <p className={formStyles.hint}>
                        Das Fahrzeug bekommt keinen Fahrer mehr, bis der Schaden behoben ist.
                    </p>
                )}
            </fieldset>

            <div className={styles.whenPair}>
                <div className={formStyles.field}>
                    <label htmlFor={`${fieldId}-date`}>Wann</label>
                    <div className={styles.whenRow}>
                        <Input
                            id={`${fieldId}-date`}
                            type="date"
                            size="md"
                            max={today}
                            value={occurredOn}
                            onChange={(event) => {
                                setOccurredOn(event.target.value);
                                clear("occurred_on");
                            }}
                            {...fieldAria(`${fieldId}-date`, errors.occurred_on)}
                        />
                        <Input
                            id={`${fieldId}-time`}
                            type="time"
                            size="md"
                            aria-label="Uhrzeit"
                            value={occurredTime}
                            onChange={(event) => {
                                setOccurredTime(event.target.value);
                                clear("occurred_time");
                            }}
                            {...fieldAria(`${fieldId}-time`, errors.occurred_time)}
                        />
                    </div>
                    <FieldError fieldId={`${fieldId}-date`} className={formStyles.error}>
                        {errors.occurred_on}
                    </FieldError>
                    <FieldError fieldId={`${fieldId}-time`} className={formStyles.error}>
                        {errors.occurred_time}
                    </FieldError>
                </div>
                <div className={formStyles.field}>
                    <span className={styles.fieldLabel}>Fahrer</span>
                    <p className={styles.readValue}>{driverName ?? "ohne Fahrer"}</p>
                </div>
            </div>

            <div className={formStyles.field}>
                <div className={styles.labelRow}>
                    <span className={styles.fieldLabel}>Wo</span>
                    {point && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="row"
                            onClick={() => {
                                setPoint(null);
                                setMoved(true);
                            }}
                        >
                            Ohne Ort
                        </Button>
                    )}
                </div>
                <PlacePickerMap
                    point={point}
                    radiusM={0}
                    center={target?.position ?? null}
                    label="Ort des Schadens: auf die Karte klicken"
                    onPick={(picked) => {
                        setPoint(picked);
                        setMoved(true);
                        clear("latitude");
                    }}
                />
                <p className={formStyles.hint}>
                    {point
                        ? `${moved ? "" : "Letzte Meldung "}${placeText(point)}; ein Klick auf die Karte setzt den Punkt neu.`
                        : "Kein Ort eingetragen; ein Klick auf die Karte setzt ihn."}
                </p>
                <FieldError fieldId={`${fieldId}-place`} className={formStyles.error}>
                    {errors.latitude}
                </FieldError>
            </div>

            <div className={formStyles.field}>
                <span className={styles.fieldLabel}>Fotos (bis {DAMAGE_PHOTOS_MAX}, freiwillig)</span>
                <div className={styles.photos}>
                    {keptPhotos.map((photoId) => (
                        <figure key={`k${photoId}`} className={styles.photo}>
                            <a
                                href={damagePhotoUrl(damage?.id ?? 0, photoId)}
                                target="_blank"
                                rel="noreferrer"
                                title="Foto groß öffnen"
                            >
                                <img src={damagePhotoUrl(damage?.id ?? 0, photoId)} alt="Foto des Schadens" />
                            </a>
                            <button
                                type="button"
                                className={styles.photoRemove}
                                aria-label="Foto entfernen"
                                onClick={() => setKeptPhotos((current) => current.filter((id) => id !== photoId))}
                            >
                                ✕
                            </button>
                        </figure>
                    ))}
                    {newPhotos.map((photo) => (
                        <figure key={`n${photo.key}`} className={styles.photo}>
                            <img src={photo.url} alt="Neues Foto des Schadens" />
                            <button
                                type="button"
                                className={styles.photoRemove}
                                aria-label="Foto entfernen"
                                onClick={() => removeNewPhoto(photo.key)}
                            >
                                ✕
                            </button>
                        </figure>
                    ))}
                    {photoCount < DAMAGE_PHOTOS_MAX && (
                        <button
                            type="button"
                            className={styles.photoAdd}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            + Foto
                        </button>
                    )}
                    <input
                        ref={fileInputRef}
                        className={styles.fileInput}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        tabIndex={-1}
                        aria-hidden
                        onChange={(event) => void choosePhotos(event)}
                    />
                </div>
                <FieldError fieldId={`${fieldId}-photos`} className={formStyles.error}>
                    {errors.photos}
                </FieldError>
            </div>

            {damage && onCloseWithoutWorkshop && (
                <div className={styles.aside}>
                    <p className={formStyles.hint}>
                        Muss nicht in die Werkstatt, etwa ein Kratzer, den die Firma so lässt?
                    </p>
                    <div>
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => onCloseWithoutWorkshop(damage)}
                        >
                            Ohne Werkstatt erledigen
                        </Button>
                    </div>
                </div>
            )}

            {onPlan && (
                <label className={styles.check}>
                    <Checkbox checked={planAfter} onChange={(event) => setPlanChoice(event.target.checked)} />
                    Danach Werkstatt-Termin planen
                </label>
            )}

            {errors.form && (
                <p className={formStyles.error} role="alert">
                    {errors.form}
                </p>
            )}

            <div className={formStyles.actions}>
                <Button type="button" variant="secondary" size="md" onClick={onCancel}>
                    Abbrechen
                </Button>
                <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    busy={isSubmitting}
                    busyLabel="Wird gespeichert…"
                >
                    {damage ? (
                        "Speichern"
                    ) : (
                        <SwapLabel swapped={planAfter} alt="Melden und Termin planen">
                            Schaden melden
                        </SwapLabel>
                    )}
                </Button>
            </div>
        </form>
    );
};
