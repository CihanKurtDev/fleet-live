import { useId, useState, type FormEvent } from "react";
import {
    DAMAGE_DESCRIPTION_MAX,
    DAMAGE_SEVERITIES,
    DAMAGE_SEVERITY_LABELS,
    berlinTodayIso,
    type Damage,
    type DamageSeverity,
} from "@fleet-live/shared";

import { ApiError } from "../../api/client";
import { reportDamage, updateDamage } from "../../api/damages";
import { Button } from "../ui/Button/Button";
import { FieldError } from "../ui/FieldError/FieldError";
import { fieldAria } from "../ui/FieldError/fieldAria";
import { Input } from "../ui/Input/Input";
import { Textarea } from "../ui/Input/Textarea";
import { Modal } from "../ui/Modal/Modal";
import formStyles from "./VehicleForm.module.scss";
import styles from "./workshop.module.scss";

type Field = "occurred_on" | "description" | "severity" | "drivable" | "form";

interface DamageDialogProps {
    /** Report a new damage on this vehicle. */
    target: { vehicleId: number; licensePlate: string } | null;
    /** Or edit this open damage. */
    damage?: Damage | null;
    licensePlate: string;
    onClose: () => void;
    onSaved: (damage: Damage, message: string) => void;
    /** Edit mode: close the damage without a workshop (the parent asks first). */
    onCloseWithoutWorkshop?: (damage: Damage) => void;
}

/** „Schaden melden“, or a reported damage to correct. */
export const DamageDialog = ({
    target,
    damage = null,
    licensePlate,
    onClose,
    onSaved,
    onCloseWithoutWorkshop,
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
                />
            )}
        </Modal>
    );
};

const DamageForm = ({
    target,
    damage,
    licensePlate,
    onCancel,
    onSaved,
    onCloseWithoutWorkshop,
}: {
    target: DamageDialogProps["target"];
    damage: Damage | null;
    licensePlate: string;
    onCancel: () => void;
    onSaved: DamageDialogProps["onSaved"];
    onCloseWithoutWorkshop?: (damage: Damage) => void;
}) => {
    const fieldId = useId();
    const today = berlinTodayIso();
    const [occurredOn, setOccurredOn] = useState(damage?.occurred_on ?? today);
    const [description, setDescription] = useState(damage?.description ?? "");
    const [severity, setSeverity] = useState<DamageSeverity>(damage?.severity ?? "MINOR");
    const [drivable, setDrivable] = useState(damage?.drivable ?? true);
    const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    const clear = (field: Field) =>
        setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        if (description.trim() === "") {
            setErrors({ description: "Was ist passiert? fehlt." });
            return;
        }

        setIsSubmitting(true);
        setErrors({});
        const input = {
            occurred_on: occurredOn,
            description: description.trim(),
            severity,
            drivable,
        };

        try {
            if (damage) {
                const { data } = await updateDamage(damage.id, input);
                onSaved(data, "Schaden gespeichert.");
            } else if (target) {
                const { data } = await reportDamage(target.vehicleId, input);
                onSaved(
                    data,
                    drivable
                        ? `Schaden an ${licensePlate} gemeldet.`
                        : `Schaden an ${licensePlate} gemeldet. Es ist nicht fahrbereit.`,
                );
            }
        } catch (caught) {
            if (caught instanceof ApiError) {
                const fields = (caught.fields ?? {}) as Partial<Record<Field, string>>;
                const known = Object.keys(fields).some((key) => key !== "drivable");
                setErrors({
                    ...fields,
                    form: known ? undefined : caught.message,
                    drivable: undefined,
                });
            } else {
                setErrors({ form: "Der Schaden wurde nicht gespeichert." });
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <form className={formStyles.form} onSubmit={handleSubmit} noValidate>
            <p className={styles.context}>{licensePlate}</p>

            <div className={formStyles.field}>
                <label htmlFor={`${fieldId}-date`}>Datum</label>
                <Input
                    id={`${fieldId}-date`}
                    type="date"
                    size="md"
                    max={today}
                    className={styles.month}
                    value={occurredOn}
                    onChange={(event) => {
                        setOccurredOn(event.target.value);
                        clear("occurred_on");
                    }}
                    {...fieldAria(`${fieldId}-date`, errors.occurred_on)}
                />
                <FieldError fieldId={`${fieldId}-date`} className={formStyles.error}>
                    {errors.occurred_on}
                </FieldError>
            </div>

            <div className={formStyles.field}>
                <label htmlFor={`${fieldId}-what`}>Was ist passiert?</label>
                <Textarea
                    id={`${fieldId}-what`}
                    data-autofocus
                    maxLength={DAMAGE_DESCRIPTION_MAX}
                    placeholder="z. B. Delle in der Heckklappe, Spiegel rechts abgerissen"
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
                <p className={formStyles.hint}>
                    {drivable
                        ? "Das Fahrzeug bleibt einsatzbereit."
                        : "Das Fahrzeug bekommt keinen Fahrer mehr, bis der Schaden behoben ist."}
                </p>
            </fieldset>

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
                    {damage ? "Speichern" : "Schaden melden"}
                </Button>
            </div>
        </form>
    );
};
