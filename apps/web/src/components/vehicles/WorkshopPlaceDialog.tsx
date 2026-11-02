import { useEffect, useId, useState, type FormEvent } from "react";
import {
    GEOCODE_QUERY_MIN,
    type GeocodeHit,
    WORKSHOP_ADDRESS_MAX,
    WORKSHOP_PHONE_MAX,
    WORKSHOP_PLACE_MAX,
    WORKSHOP_RADIUS_DEFAULT_M,
    WORKSHOP_RADIUS_MAX_M,
    WORKSHOP_RADIUS_MIN_M,
    type WorkshopPlace,
} from "@fleet-live/shared";

import { ApiError } from "../../api/client";
import {
    createWorkshopPlace,
    deleteWorkshopPlace,
    getGeocodeConfig,
    searchAddress,
    updateWorkshopPlace,
} from "../../api/workshop";
import { Button } from "../ui/Button/Button";
import { ConfirmDialog } from "../ui/Modal/ConfirmDialog";
import { FieldError } from "../ui/FieldError/FieldError";
import { fieldAria } from "../ui/FieldError/fieldAria";
import { Input } from "../ui/Input/Input";
import { Modal } from "../ui/Modal/Modal";
import { PlacePickerMap, type PickedPoint } from "./PlacePickerMap";
import formStyles from "./VehicleForm.module.scss";
import styles from "./workshop.module.scss";

type Field = "name" | "address" | "phone" | "latitude" | "radius_m" | "form";

interface WorkshopPlaceDialogProps {
    open: boolean;
    /** Edit this workshop; a new one when absent. */
    place?: WorkshopPlace | null;
    /** Where the map opens for a new workshop. */
    center?: PickedPoint | null;
    onClose: () => void;
    onSaved: (place: WorkshopPlace) => void;
    /** Edit mode: offers „Werkstatt löschen“ (asks first; refused while a stay uses it). */
    onDeleted?: (place: WorkshopPlace) => void;
}

/** A workshop of the company: name, contact and its place on the map. */
export const WorkshopPlaceDialog = ({
    open,
    place = null,
    center,
    onClose,
    onSaved,
    onDeleted,
}: WorkshopPlaceDialogProps) => (
    <Modal open={open} onClose={onClose} title={place ? "Werkstatt bearbeiten" : "Werkstatt anlegen"} guardUnsaved>
        {open && (
            <PlaceForm
                key={place?.id ?? "new"}
                place={place}
                center={center ?? null}
                onCancel={onClose}
                onSaved={onSaved}
                onDeleted={onDeleted}
            />
        )}
    </Modal>
);

const PlaceForm = ({
    place,
    center,
    onCancel,
    onSaved,
    onDeleted,
}: {
    place: WorkshopPlace | null;
    center: PickedPoint | null;
    onCancel: () => void;
    onSaved: (place: WorkshopPlace) => void;
    onDeleted?: (place: WorkshopPlace) => void;
}) => {
    const fieldId = useId();
    const [name, setName] = useState(place?.name ?? "");
    const [address, setAddress] = useState(place?.address ?? "");
    const [phone, setPhone] = useState(place?.phone ?? "");
    const [point, setPoint] = useState<PickedPoint | null>(
        place ? { latitude: place.latitude, longitude: place.longitude } : null,
    );
    const [radius, setRadius] = useState(place?.radius_m ?? WORKSHOP_RADIUS_DEFAULT_M);
    const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [searchOn, setSearchOn] = useState(false);
    const [searching, setSearching] = useState(false);
    const [hits, setHits] = useState<GeocodeHit[] | null>(null);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        getGeocodeConfig(controller.signal)
            .then((body) => setSearchOn(body.data.enabled))
            .catch(() => setSearchOn(false));
        return () => controller.abort();
    }, []);

    const runSearch = async () => {
        if (address.trim().length < GEOCODE_QUERY_MIN) {
            setSearchError("Erst die Adresse eintragen, dann suchen.");
            return;
        }
        setSearching(true);
        setSearchError(null);
        try {
            const { data } = await searchAddress(address.trim());
            setHits(data);
            if (data.length === 0) {
                setSearchError("Nichts gefunden. Adresse genauer schreiben oder den Ort auf der Karte anklicken.");
            }
        } catch (caught) {
            setHits(null);
            setSearchError(caught instanceof Error ? caught.message : "Die Suche hat nicht geklappt.");
        } finally {
            setSearching(false);
        }
    };

    const remove = async () => {
        if (!place) {
            return;
        }
        setDeleting(true);
        setDeleteError(null);
        try {
            await deleteWorkshopPlace(place.id);
            setConfirmDelete(false);
            onDeleted?.(place);
        } catch (caught) {
            setDeleteError(caught instanceof Error ? caught.message : "Die Werkstatt wurde nicht gelöscht.");
        } finally {
            setDeleting(false);
        }
    };

    const clear = (field: Field) =>
        setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        const local: Partial<Record<Field, string>> = {};
        if (name.trim() === "") local.name = "Name fehlt.";
        if (!point) local.latitude = "Klicken Sie auf die Karte, wo die Werkstatt liegt.";
        if (Object.keys(local).length > 0 || !point) {
            setErrors(local);
            return;
        }

        setIsSubmitting(true);
        setErrors({});
        const input = {
            name: name.trim(),
            address: address.trim() || null,
            phone: phone.trim() || null,
            latitude: point.latitude,
            longitude: point.longitude,
            radius_m: radius,
        };

        try {
            const { data } = place
                ? await updateWorkshopPlace(place.id, input)
                : await createWorkshopPlace(input);
            onSaved(data);
        } catch (caught) {
            if (caught instanceof ApiError) {
                const fields = (caught.fields ?? {}) as Partial<Record<Field, string>>;
                setErrors({ ...fields, form: Object.keys(fields).length > 0 ? undefined : caught.message });
            } else {
                setErrors({ form: "Die Werkstatt wurde nicht gespeichert." });
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <form className={formStyles.form} onSubmit={handleSubmit} noValidate>
            <p className={styles.context}>
                Werkstätten sind Orte der Firma, wie Depots. Sie stehen danach auf der Karte und in jedem Termin zur Auswahl.
            </p>

            <div className={formStyles.field}>
                <label htmlFor={`${fieldId}-name`}>Name</label>
                <Input
                    id={`${fieldId}-name`}
                    data-autofocus
                    size="md"
                    fullWidth
                    maxLength={WORKSHOP_PLACE_MAX}
                    value={name}
                    onChange={(event) => {
                        setName(event.target.value);
                        clear("name");
                    }}
                    {...fieldAria(`${fieldId}-name`, errors.name)}
                />
                <FieldError fieldId={`${fieldId}-name`} className={formStyles.error}>
                    {errors.name}
                </FieldError>
            </div>

            <div className={styles.addressRow}>
                <div className={formStyles.field}>
                    <label htmlFor={`${fieldId}-address`}>Adresse</label>
                    <Input
                        id={`${fieldId}-address`}
                        size="md"
                        fullWidth
                        maxLength={WORKSHOP_ADDRESS_MAX}
                        value={address}
                        onChange={(event) => {
                            setAddress(event.target.value);
                            setHits(null);
                            setSearchError(null);
                            clear("address");
                        }}
                        onKeyDown={(event) => {
                            // Enter searches instead of saving the half-filled form.
                            if (searchOn && event.key === "Enter") {
                                event.preventDefault();
                                void runSearch();
                            }
                        }}
                        {...fieldAria(`${fieldId}-address`, errors.address)}
                    />
                    <FieldError fieldId={`${fieldId}-address`} className={formStyles.error}>
                        {errors.address}
                    </FieldError>
                </div>
                <div className={formStyles.field}>
                    <label htmlFor={`${fieldId}-phone`}>Telefon</label>
                    <Input
                        id={`${fieldId}-phone`}
                        type="tel"
                        size="md"
                        fullWidth
                        maxLength={WORKSHOP_PHONE_MAX}
                        value={phone}
                        onChange={(event) => {
                            setPhone(event.target.value);
                            clear("phone");
                        }}
                        {...fieldAria(`${fieldId}-phone`, errors.phone)}
                    />
                    <FieldError fieldId={`${fieldId}-phone`} className={formStyles.error}>
                        {errors.phone}
                    </FieldError>
                </div>
            </div>

            {searchOn && (
                <div className={styles.geocode}>
                    <div>
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            busy={searching}
                            busyLabel="Sucht…"
                            onClick={() => void runSearch()}
                        >
                            Adresse auf der Karte suchen
                        </Button>
                    </div>
                    {searchError && <p className={formStyles.hint} role="status">{searchError}</p>}
                    {hits && hits.length > 0 && (
                        <>
                            <ul className={styles.geocodeHits} aria-label="Treffer der Adresssuche">
                                {hits.map((hit) => (
                                    <li key={`${hit.latitude},${hit.longitude}`}>
                                        <button
                                            type="button"
                                            className={styles.geocodeHit}
                                            onClick={() => {
                                                setPoint({ latitude: hit.latitude, longitude: hit.longitude });
                                                setHits(null);
                                                clear("latitude");
                                            }}
                                        >
                                            {hit.label}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                            <p className={styles.geocodeCredit}>Adressdaten © OpenStreetMap-Mitwirkende</p>
                        </>
                    )}
                </div>
            )}

            <div className={formStyles.field}>
                <span className={styles.fieldLabel} id={`${fieldId}-map-label`}>
                    Ort auf der Karte
                </span>
                <PlacePickerMap
                    point={point}
                    radiusM={radius}
                    center={center}
                    label="Karte: klicken setzt den Ort der Werkstatt"
                    onPick={(next) => {
                        setPoint(next);
                        clear("latitude");
                    }}
                />
                <p className={formStyles.hint} id={`${fieldId}-map-hint`}>
                    Klick auf die Karte setzt den Ort. Parkt ein Fahrzeug im Kreis, gilt es als angekommen.
                </p>
                <FieldError fieldId={`${fieldId}-map`} className={formStyles.error}>
                    {errors.latitude}
                </FieldError>
            </div>

            <div className={formStyles.field}>
                <label htmlFor={`${fieldId}-radius`}>Kreis: {radius} m</label>
                <Input
                    id={`${fieldId}-radius`}
                    type="range"
                    min={WORKSHOP_RADIUS_MIN_M}
                    max={WORKSHOP_RADIUS_MAX_M}
                    step={10}
                    value={radius}
                    onChange={(event) => setRadius(Number(event.target.value))}
                    {...fieldAria(`${fieldId}-radius`, errors.radius_m, `${fieldId}-radius-hint`)}
                />
                <p className={formStyles.hint} id={`${fieldId}-radius-hint`}>
                    So groß, dass Hof und Parkplatz der Werkstatt drin liegen, aber keine Nachbarstraße.
                </p>
            </div>

            {errors.form && (
                <p className={formStyles.error} role="alert">
                    {errors.form}
                </p>
            )}

            <div className={formStyles.actions}>
                {place && onDeleted && (
                    <Button
                        type="button"
                        variant="dangerOutline"
                        size="md"
                        className={styles.actionsStart}
                        onClick={() => {
                            setDeleteError(null);
                            setConfirmDelete(true);
                        }}
                    >
                        Werkstatt löschen
                    </Button>
                )}
                <Button type="button" variant="secondary" size="md" onClick={onCancel}>
                    Abbrechen
                </Button>
                <Button type="submit" size="md" busy={isSubmitting} busyLabel="Wird gespeichert…">
                    {place ? "Speichern" : "Werkstatt anlegen"}
                </Button>
            </div>

            {place && (
                <ConfirmDialog
                    open={confirmDelete}
                    onClose={() => setConfirmDelete(false)}
                    title="Werkstatt löschen?"
                    confirmLabel="Löschen"
                    busyLabel="Wird gelöscht…"
                    isBusy={deleting}
                    onConfirm={() => void remove()}
                    items={[{ key: place.id, name: place.name, detail: place.address ?? undefined }]}
                    itemsLabel="Werkstatt"
                    error={deleteError}
                >
                    <p>
                        Sie verschwindet von der Karte und aus der Auswahl. Frühere Aufenthalte behalten ihren Namen; solange
                        ein offener Termin sie nutzt, lässt sie sich nicht löschen.
                    </p>
                </ConfirmDialog>
            )}
        </form>
    );
};
