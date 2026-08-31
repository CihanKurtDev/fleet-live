import { useId, useState, type FormEvent } from "react";
import {
    DRIVER_NAME_MAX,
    LICENSE_PLATE_MAX,
    validateVehicleInput,
    type VehicleFieldErrors,
    type VehicleInput,
} from "@fleet-live/shared";
import { Button } from "../ui/Button/Button";
import { NEW_VEHICLE_STATUS } from "./vehicleStatus";
import styles from "./VehicleForm.module.scss";

/**
 * Stammdaten sind das, was ein Mensch pflegt. Status und Position meldet das
 * Fahrzeug; der Tankstand nur dann, wenn es gerade unterwegs ist.
 *
 * Der Tankstand bleibt im Formular ein String, damit das Feld leerbar ist.
 */
interface FormValues {
    license_plate: string;
    driver_name: string;
    fuel_level: string;
}

const EMPTY_VALUES: FormValues = {
    license_plate: "",
    driver_name: "",
    fuel_level: "100",
};

const toValues = (input?: VehicleInput): FormValues =>
    input
        ? {
              license_plate: input.license_plate,
              driver_name: input.driver_name,
              fuel_level: String(Math.round(input.fuel_level)),
          }
        : EMPTY_VALUES;

interface VehicleFormProps {
    /** Vorhanden im Bearbeiten-Modus, leer beim Anlegen. */
    initialValue?: VehicleInput;

    /**
     * Solange das Fahrzeug fährt, kommt der Tankstand aus der Telemetrie.
     * Dann wird er nur angezeigt und nicht überschrieben.
     */
    isFuelMeasured?: boolean;
    readOnly?: boolean;

    submitLabel: string;
    onSubmit: (
        input: VehicleInput,
    ) => VehicleFieldErrors | void | Promise<VehicleFieldErrors | void>;
    onCancel?: () => void;
}

export const VehicleForm = ({
    initialValue,
    isFuelMeasured = false,
    readOnly = false,
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

    const toInput = (): Partial<VehicleInput> => ({
        license_plate: values.license_plate,
        driver_name: values.driver_name,
        // Ein gemessener Tankstand darf nicht durch einen alten Formularwert
        // ersetzt werden, während der Simulator ihn weiterschreibt.
        fuel_level:
            isFuelMeasured && initialValue
                ? initialValue.fuel_level
                : values.fuel_level.trim() === ""
                  ? Number.NaN
                  : Number(values.fuel_level),
        status: initialValue?.status ?? NEW_VEHICLE_STATUS,
    });

    const editable = ({ license_plate, driver_name, fuel_level }: FormValues) =>
        isFuelMeasured
            ? { license_plate, driver_name }
            : { license_plate, driver_name, fuel_level };

    const isDirty =
        JSON.stringify(editable(values)) !==
        JSON.stringify(editable(toValues(initialValue)));

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

        if (readOnly) {
            return;
        }
        setWasSubmitted(true);

        const input = toInput();
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
                    maxLength={LICENSE_PLATE_MAX}
                    value={values.license_plate}
                    disabled={readOnly}
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
                    maxLength={DRIVER_NAME_MAX}
                    value={values.driver_name}
                    disabled={readOnly}
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
                    disabled={readOnly || isFuelMeasured}
                    onChange={(event) =>
                        setField(
                            "fuel_level",
                            event.target.value,
                        )
                    }
                    aria-invalid={
                        errorFor("fuel_level") !== undefined
                    }
                    aria-describedby={
                        isFuelMeasured ? `${fieldId}-fuel-hint` : undefined
                    }
                />
                {isFuelMeasured && (
                    <p className={styles.hint} id={`${fieldId}-fuel-hint`}>
                        Wird während der Fahrt vom Fahrzeug gemeldet. Von Hand
                        pflegbar, sobald die Fahrt beendet ist.
                    </p>
                )}
                {errorFor("fuel_level") && (
                    <p className={styles.error} role="alert">
                        {errorFor("fuel_level")}
                    </p>
                )}
            </div>

            {!readOnly && (
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
            )}
        </form>
    );
};
