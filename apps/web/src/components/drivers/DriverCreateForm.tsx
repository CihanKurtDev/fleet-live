import { useId, useState, type FormEvent } from "react";
import { DRIVER_NAME_MAX } from "@fleet-live/shared";

import { ApiError } from "../../api/client";
import { createDriver } from "../../api/drivers";
import { Button } from "../ui/Button/Button";
import styles from "../vehicles/VehicleForm.module.scss";

interface DriverCreateFormProps {
    submitLabel?: string;
    onCreated: (driver: { id: number; name: string }) => void;
    onCancel?: () => void;
}

export const DriverCreateForm = ({
    submitLabel = "Anlegen",
    onCreated,
    onCancel,
}: DriverCreateFormProps) => {
    const fieldId = useId();
    const [name, setName] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        const trimmed = name.trim();

        if (trimmed === "") {
            setError("Name ist erforderlich.");
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            const created = await createDriver({ name: trimmed });
            onCreated(created);
        } catch (caught) {
            setError(
                caught instanceof ApiError
                    ? caught.message
                    : "Fahrer konnte nicht angelegt werden.",
            );
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <div className={styles.field}>
                <label htmlFor={fieldId}>Name</label>
                <input
                    id={fieldId}
                    type="text"
                    maxLength={DRIVER_NAME_MAX}
                    value={name}
                    onChange={(event) => {
                        setName(event.target.value);
                        setError(null);
                    }}
                    aria-invalid={error !== null}
                />
                {error && (
                    <p className={styles.error} role="alert">
                        {error}
                    </p>
                )}
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
                <Button type="submit" size="sm" disabled={isSubmitting}>
                    {submitLabel}
                </Button>
            </div>
        </form>
    );
};
