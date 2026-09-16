import { useId, useState, type FormEvent } from "react";
import {
    COST_CENTER_MAX,
    DEPOT_MAX,
    LICENSE_PLATE_MAX,
    VEHICLE_TYPES,
    VEHICLE_TYPE_LABELS,
    VIN_LENGTH,
    validateVehicleInput,
    type VehicleFieldErrors,
    type VehicleInput,
    type VehicleType,
} from "@fleet-live/shared";
import { Button } from "../ui/Button/Button";
import { Input } from "../ui/Input/Input";
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
    fuel_level: string;
    vin: string;
    vehicle_type: VehicleType | "";
    hu_due_on: string;
    depot: string;
    cost_center: string;
}

const EMPTY_VALUES: FormValues = {
    license_plate: "",
    fuel_level: "100",
    vin: "",
    vehicle_type: "",
    hu_due_on: "",
    depot: "",
    cost_center: "",
};

const toValues = (input?: VehicleInput): FormValues =>
    input
        ? {
              license_plate: input.license_plate,
              fuel_level: String(Math.round(input.fuel_level)),
              vin: input.vin ?? "",
              vehicle_type: input.vehicle_type ?? "",
              hu_due_on: input.hu_due_on ?? "",
              depot: input.depot ?? "",
              cost_center: input.cost_center ?? "",
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
        // Ein gemessener Tankstand darf nicht durch einen alten Formularwert
        // ersetzt werden, während der Simulator ihn weiterschreibt.
        fuel_level:
            isFuelMeasured && initialValue
                ? initialValue.fuel_level
                : values.fuel_level.trim() === ""
                  ? Number.NaN
                  : Number(values.fuel_level),
        status: initialValue?.status ?? NEW_VEHICLE_STATUS,
        vin: values.vin.trim() === "" ? null : values.vin,
        vehicle_type:
            values.vehicle_type === "" ? null : values.vehicle_type,
        hu_due_on: values.hu_due_on.trim() === "" ? null : values.hu_due_on,
        depot: values.depot.trim() === "" ? null : values.depot,
        cost_center:
            values.cost_center.trim() === "" ? null : values.cost_center,
    });

    const editable = (form: FormValues) =>
        isFuelMeasured
            ? {
                  license_plate: form.license_plate,
                  vin: form.vin,
                  vehicle_type: form.vehicle_type,
                  hu_due_on: form.hu_due_on,
                  depot: form.depot,
                  cost_center: form.cost_center,
              }
            : form;

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
                <Input
                    id={`${fieldId}-plate`}
                    type="text"
                    size="md"
                    fullWidth
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
                <label htmlFor={`${fieldId}-vin`}>VIN</label>
                <Input
                    id={`${fieldId}-vin`}
                    type="text"
                    size="md"
                    fullWidth
                    maxLength={VIN_LENGTH}
                    value={values.vin}
                    disabled={readOnly}
                    onChange={(event) =>
                        setField("vin", event.target.value)
                    }
                    aria-invalid={errorFor("vin") !== undefined}
                />
                {errorFor("vin") && (
                    <p className={styles.error} role="alert">
                        {errorFor("vin")}
                    </p>
                )}
            </div>

            <div className={styles.field}>
                <label htmlFor={`${fieldId}-type`}>Fahrzeugtyp</label>
                <select
                    id={`${fieldId}-type`}
                    className={styles.select}
                    value={values.vehicle_type}
                    disabled={readOnly}
                    onChange={(event) =>
                        setField(
                            "vehicle_type",
                            event.target.value as VehicleType | "",
                        )
                    }
                    aria-invalid={errorFor("vehicle_type") !== undefined}
                >
                    <option value="">—</option>
                    {VEHICLE_TYPES.map((type) => (
                        <option key={type} value={type}>
                            {VEHICLE_TYPE_LABELS[type]}
                        </option>
                    ))}
                </select>
                {errorFor("vehicle_type") && (
                    <p className={styles.error} role="alert">
                        {errorFor("vehicle_type")}
                    </p>
                )}
            </div>

            <div className={styles.field}>
                <label htmlFor={`${fieldId}-hu`}>HU fällig</label>
                <Input
                    id={`${fieldId}-hu`}
                    type="date"
                    size="md"
                    fullWidth
                    value={values.hu_due_on}
                    disabled={readOnly}
                    onChange={(event) =>
                        setField("hu_due_on", event.target.value)
                    }
                    aria-invalid={errorFor("hu_due_on") !== undefined}
                />
                {errorFor("hu_due_on") && (
                    <p className={styles.error} role="alert">
                        {errorFor("hu_due_on")}
                    </p>
                )}
            </div>

            <div className={styles.field}>
                <label htmlFor={`${fieldId}-depot`}>Standort</label>
                <Input
                    id={`${fieldId}-depot`}
                    type="text"
                    size="md"
                    fullWidth
                    maxLength={DEPOT_MAX}
                    value={values.depot}
                    disabled={readOnly}
                    onChange={(event) =>
                        setField("depot", event.target.value)
                    }
                    aria-invalid={errorFor("depot") !== undefined}
                />
                {errorFor("depot") && (
                    <p className={styles.error} role="alert">
                        {errorFor("depot")}
                    </p>
                )}
            </div>

            <div className={styles.field}>
                <label htmlFor={`${fieldId}-cost`}>Kostenstelle</label>
                <Input
                    id={`${fieldId}-cost`}
                    type="text"
                    size="md"
                    fullWidth
                    maxLength={COST_CENTER_MAX}
                    value={values.cost_center}
                    disabled={readOnly}
                    onChange={(event) =>
                        setField("cost_center", event.target.value)
                    }
                    aria-invalid={errorFor("cost_center") !== undefined}
                />
                {errorFor("cost_center") && (
                    <p className={styles.error} role="alert">
                        {errorFor("cost_center")}
                    </p>
                )}
            </div>

            <div className={styles.field}>
                <label htmlFor={`${fieldId}-fuel`}>
                    Tankstand (%)
                </label>
                <Input
                    id={`${fieldId}-fuel`}
                    type="number"
                    size="md"
                    fullWidth
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
