import { useId, useState, type FormEvent } from "react";
import {
    VEHICLE_STATUSES,
    validateVehicleInput,
    type VehicleFieldErrors,
    type VehicleInput,
    type VehicleStatus,
} from "@fleet-live/shared";
import { Button } from "../ui/Button/Button";
import styles from "./VehicleForm.module.scss";

/** Im Formular bleibt der Tankstand ein String, damit das Feld leerbar ist. */
interface FormValues {
    license_plate: string;
    driver_name: string;
    fuel_level: string;
    status: VehicleStatus;
}

const EMPTY_VALUES: FormValues = {
    license_plate: "",
    driver_name: "",
    fuel_level: "100",
    status: "IDLE",
};

const STATUS_LABELS: Record<VehicleStatus, string> = {
    IDLE: "Standby",
    DRIVING: "Unterwegs",
    STOPPED: "Gestoppt",
    OFFLINE: "Offline",
};

const toValues = (input?: VehicleInput): FormValues =>
    input
        ? {
              license_plate: input.license_plate,
              driver_name: input.driver_name,
              fuel_level: String(input.fuel_level),
              status: input.status,
          }
        : EMPTY_VALUES;

const toInput = (
    values: FormValues,
): Partial<VehicleInput> => ({
    license_plate: values.license_plate,
    driver_name: values.driver_name,
    fuel_level:
        values.fuel_level.trim() === ""
            ? Number.NaN
            : Number(values.fuel_level),
    status: values.status,
});

interface VehicleFormProps {
    /** Vorhanden im Bearbeiten-Modus, leer beim Anlegen. */
    initialValue?: VehicleInput;

    submitLabel: string;
    onSubmit: (
        input: VehicleInput,
    ) => VehicleFieldErrors | void | Promise<VehicleFieldErrors | void>;
    onCancel?: () => void;
}

export const VehicleForm = ({
    initialValue,
    submitLabel,
    onSubmit,
    onCancel,
}: VehicleFormProps) => {
    const fieldId = useId();

    const [values, setValues] = useState<FormValues>(() =>
        toValues(initialValue),
    );
    const [errors, setErrors] =
        useState<VehicleFieldErrors>({});
    const [wasSubmitted, setWasSubmitted] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const isEditing = initialValue !== undefined;

    const isDirty =
        JSON.stringify(values) !==
        JSON.stringify(toValues(initialValue));

    const setField = <Key extends keyof FormValues>(
        key: Key,
        value: FormValues[Key],
    ) => {
        setValues((current) => ({ ...current, [key]: value }));

        // Fehler des Feldes verschwindet, sobald daran gearbeitet wird.
        setErrors((current) => {
            if (!current[key as keyof VehicleFieldErrors]) {
                return current;
            }

            const next = { ...current };
            delete next[key as keyof VehicleFieldErrors];
            return next;
        });
    };

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setWasSubmitted(true);

        const input = toInput(values);
        const validationErrors = validateVehicleInput(input);

        if (Object.keys(validationErrors).length > 0) {
            setErrors(validationErrors);
            return;
        }

        setIsSubmitting(true);

        try {
            // Der Aufrufer darf weitere Fehler melden, z. B. ein
            // bereits vergebenes Kennzeichen (API antwortet darauf mit 409).
            const submitErrors = await onSubmit(
                input as VehicleInput,
            );

            if (
                submitErrors &&
                Object.keys(submitErrors).length > 0
            ) {
                setErrors(submitErrors);
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const errorFor = (field: keyof VehicleFieldErrors) =>
        wasSubmitted ? errors[field] : undefined;

    return (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <div className={styles.field}>
                <label htmlFor={`${fieldId}-plate`}>
                    Kennzeichen
                </label>
                <input
                    id={`${fieldId}-plate`}
                    type="text"
                    value={values.license_plate}
                    onChange={(event) =>
                        setField(
                            "license_plate",
                            event.target.value,
                        )
                    }
                    aria-invalid={
                        errorFor("license_plate") !== undefined
                    }
                />
                {errorFor("license_plate") && (
                    <p className={styles.error} role="alert">
                        {errorFor("license_plate")}
                    </p>
                )}
            </div>

            <div className={styles.field}>
                <label htmlFor={`${fieldId}-driver`}>
                    Fahrer
                </label>
                <input
                    id={`${fieldId}-driver`}
                    type="text"
                    value={values.driver_name}
                    onChange={(event) =>
                        setField(
                            "driver_name",
                            event.target.value,
                        )
                    }
                    aria-invalid={
                        errorFor("driver_name") !== undefined
                    }
                />
                {errorFor("driver_name") && (
                    <p className={styles.error} role="alert">
                        {errorFor("driver_name")}
                    </p>
                )}
            </div>

            <div className={styles.row}>
                <div className={styles.field}>
                    <label htmlFor={`${fieldId}-fuel`}>
                        Tankstand (%)
                    </label>
                    <input
                        id={`${fieldId}-fuel`}
                        type="number"
                        min={0}
                        max={100}
                        value={values.fuel_level}
                        onChange={(event) =>
                            setField(
                                "fuel_level",
                                event.target.value,
                            )
                        }
                        aria-invalid={
                            errorFor("fuel_level") !== undefined
                        }
                    />
                    {errorFor("fuel_level") && (
                        <p className={styles.error} role="alert">
                            {errorFor("fuel_level")}
                        </p>
                    )}
                </div>

                <div className={styles.field}>
                    <label htmlFor={`${fieldId}-status`}>
                        Status
                    </label>
                    <select
                        id={`${fieldId}-status`}
                        value={values.status}
                        onChange={(event) =>
                            setField(
                                "status",
                                event.target
                                    .value as VehicleStatus,
                            )
                        }
                    >
                        {VEHICLE_STATUSES.map((status) => (
                            <option key={status} value={status}>
                                {STATUS_LABELS[status]}
                            </option>
                        ))}
                    </select>
                    {errorFor("status") && (
                        <p className={styles.error} role="alert">
                            {errorFor("status")}
                        </p>
                    )}
                </div>
            </div>

            <div className={styles.actions}>
                {onCancel && (
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={onCancel}
                    >
                        Abbrechen
                    </Button>
                )}

                <Button
                    type="submit"
                    size="sm"
                    disabled={isSubmitting || (isEditing && !isDirty)}
                >
                    {submitLabel}
                </Button>
            </div>
        </form>
    );
};
