import { useEffect, useId, useState, type FormEvent } from "react";
import {
    ODOMETER_NOTE_MAX,
    ODOMETER_SOURCE_LABELS,
    parseKilometerText,
    type VehicleOdometer,
} from "@fleet-live/shared";

import { ApiError, isAbortError } from "../../api/client";
import { correctVehicleOdometer, getVehicleOdometer } from "../../api/odometer";
import { formatTimestamp } from "../../utils/dateTime";
import { Button } from "../ui/Button/Button";
import { FieldError } from "../ui/FieldError/FieldError";
import { fieldAria } from "../ui/FieldError/fieldAria";
import { Input } from "../ui/Input/Input";
import { Modal } from "../ui/Modal/Modal";
import { formatKm } from "./odometerText";
import formStyles from "./VehicleForm.module.scss";
import styles from "./workshop.module.scss";

type Field = "km" | "note" | "form";

interface OdometerDialogProps {
    /** The vehicle whose reading is shown; `null` keeps the dialog closed. */
    vehicle: { id: number; license_plate: string } | null;
    canWrite: boolean;
    onClose: () => void;
    onSaved: (message: string) => void;
}

/**
 * „Kilometerstand“: the reading with every change people or the import made.
 * A dispatcher corrects it to what the dashboard shows; driving is not logged,
 * it adds to the reading on its own.
 */
export const OdometerDialog = ({ vehicle, canWrite, onClose, onSaved }: OdometerDialogProps) => (
    <Modal open={vehicle !== null} onClose={onClose} title="Kilometerstand" guardUnsaved>
        {vehicle && (
            <OdometerBody
                key={vehicle.id}
                vehicle={vehicle}
                canWrite={canWrite}
                onCancel={onClose}
                onSaved={onSaved}
            />
        )}
    </Modal>
);

const OdometerBody = ({
    vehicle,
    canWrite,
    onCancel,
    onSaved,
}: {
    vehicle: { id: number; license_plate: string };
    canWrite: boolean;
    onCancel: () => void;
    onSaved: (message: string) => void;
}) => {
    const fieldId = useId();
    const [odometer, setOdometer] = useState<VehicleOdometer | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [reload, setReload] = useState(0);
    const [km, setKm] = useState("");
    const [note, setNote] = useState("");
    const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        const controller = new AbortController();
        getVehicleOdometer(vehicle.id, controller.signal)
            .then((response) => {
                setOdometer(response.data);
                setLoadError(null);
            })
            .catch((caught: unknown) => {
                if (!isAbortError(caught)) {
                    setLoadError("Kilometerstand konnte nicht geladen werden.");
                }
            });
        return () => controller.abort();
    }, [vehicle.id, reload]);

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        const parsed = parseKilometerText(km);

        if (parsed === null) {
            setErrors({ km: "Stand laut Tacho fehlt." });
            return;
        }
        if (parsed === "invalid") {
            setErrors({ km: "Kilometerstand in ganzen Kilometern angeben, z. B. 123.456." });
            return;
        }

        setIsSubmitting(true);
        setErrors({});

        try {
            await correctVehicleOdometer(vehicle.id, { km: parsed, note: note.trim() || null });
            onSaved(`Kilometerstand von ${vehicle.license_plate} auf ${formatKm(parsed)} gesetzt.`);
        } catch (caught) {
            if (caught instanceof ApiError) {
                const fields = (caught.fields ?? {}) as Partial<Record<Field, string>>;
                const known = Object.keys(fields).length > 0;
                setErrors({ ...fields, form: known ? undefined : caught.message });
            } else {
                setErrors({ form: "Speichern hat nicht geklappt." });
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    if (loadError) {
        return (
            <div className={formStyles.form}>
                <p className={formStyles.error} role="alert">
                    {loadError}
                </p>
                <div>
                    <Button variant="secondary" size="md" onClick={() => setReload((value) => value + 1)}>
                        Erneut versuchen
                    </Button>
                </div>
            </div>
        );
    }

    const history = (
        <section className={styles.history} aria-label="Verlauf">
            <h3 className={styles.historyHead}>
                <b>Verlauf</b>
                <span>eingetragen, importiert und korrigiert</span>
            </h3>
            {odometer === null ? (
                <p className={styles.historyNote}>Wird geladen …</p>
            ) : odometer.readings.length === 0 ? (
                <p className={styles.historyNote}>Noch kein Stand eingetragen.</p>
            ) : (
                <ol className={styles.historyList}>
                    {odometer.readings.map((reading) => (
                        <li key={reading.id} className={styles.historyRow}>
                            <span className={styles.time}>{formatTimestamp(reading.created_at)}</span>
                            <span className={styles.what}>
                                {reading.previous_km === null
                                    ? formatKm(reading.km)
                                    : `${formatKm(reading.previous_km)} → ${formatKm(reading.km)}`}{" "}
                                <span className={styles.muted}>
                                    · {ODOMETER_SOURCE_LABELS[reading.source]}
                                    {reading.note ? ` · ${reading.note}` : ""}
                                </span>
                            </span>
                            <span>{reading.actor_name || "—"}</span>
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );

    const context = (
        <p className={styles.context}>
            {vehicle.license_plate} ·{" "}
            {odometer?.km == null ? "kein Stand eingetragen" : `jetzt ${formatKm(odometer.km)}`} · wächst mit
            jeder gemeldeten Fahrt
        </p>
    );

    if (!canWrite) {
        return (
            <div className={formStyles.form}>
                {context}
                {history}
            </div>
        );
    }

    return (
        <form className={formStyles.form} onSubmit={handleSubmit} noValidate>
            {context}

            <div className={styles.pair}>
                <div className={formStyles.field}>
                    <label htmlFor={`${fieldId}-km`}>Stand laut Tacho (km)</label>
                    <Input
                        id={`${fieldId}-km`}
                        size="md"
                        fullWidth
                        inputMode="numeric"
                        placeholder="z. B. 123.456"
                        value={km}
                        onChange={(event) => {
                            setKm(event.target.value);
                            setErrors((current) => ({ ...current, km: undefined, form: undefined }));
                        }}
                        {...fieldAria(`${fieldId}-km`, errors.km)}
                    />
                    <FieldError fieldId={`${fieldId}-km`} className={formStyles.error}>
                        {errors.km}
                    </FieldError>
                </div>
                <div className={formStyles.field}>
                    <label htmlFor={`${fieldId}-note`}>Grund</label>
                    <Input
                        id={`${fieldId}-note`}
                        size="md"
                        fullWidth
                        maxLength={ODOMETER_NOTE_MAX}
                        placeholder="z. B. Werkstattrechnung"
                        value={note}
                        onChange={(event) => {
                            setNote(event.target.value);
                            setErrors((current) => ({ ...current, note: undefined, form: undefined }));
                        }}
                        {...fieldAria(`${fieldId}-note`, errors.note, `${fieldId}-note-hint`)}
                    />
                    <p className={formStyles.hint} id={`${fieldId}-note-hint`}>
                        Freiwillig.
                    </p>
                    <FieldError fieldId={`${fieldId}-note`} className={formStyles.error}>
                        {errors.note}
                    </FieldError>
                </div>
            </div>

            {history}

            {errors.form && (
                <p className={formStyles.error} role="alert">
                    {errors.form}
                </p>
            )}

            <div className={formStyles.actions}>
                <Button type="button" variant="secondary" size="md" onClick={onCancel}>
                    Abbrechen
                </Button>
                <Button type="submit" size="md" busy={isSubmitting} busyLabel="Wird gespeichert…">
                    Speichern
                </Button>
            </div>
        </form>
    );
};
