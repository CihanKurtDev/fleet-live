import { useId, useState, type FormEvent } from "react";
import {
    DRIVER_NAME_MAX,
    DRIVER_PHONE_MAX,
} from "@fleet-live/shared";

import { ApiError } from "../../api/client";
import { createDriver } from "../../api/drivers";
import { Button } from "../ui/Button/Button";
import { Input } from "../ui/Input/Input";
import styles from "../vehicles/VehicleForm.module.scss";

interface DriverCreateFormProps {
    submitLabel?: string;
    onCreated: (driver: {
        id: number;
        name: string;
        phone: string | null;
    }) => void;
    onCancel?: () => void;
}

function validateDriverFields(name: string, phone: string): {
    name?: string;
    phone?: string;
} {
    const errors: { name?: string; phone?: string } = {};
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();

    if (trimmedName === "") {
        errors.name = "Name ist erforderlich.";
    } else if (trimmedName.length > DRIVER_NAME_MAX) {
        errors.name = `Name darf höchstens ${DRIVER_NAME_MAX} Zeichen haben.`;
    }

    if (trimmedPhone !== "") {
        if (trimmedPhone.length > DRIVER_PHONE_MAX) {
            errors.phone = `Telefon darf höchstens ${DRIVER_PHONE_MAX} Zeichen haben.`;
        } else if (!/[0-9]/.test(trimmedPhone)) {
            errors.phone = "Telefonnummer muss Ziffern enthalten.";
        }
    }

    return errors;
}

export const DriverCreateForm = ({
    submitLabel = "Anlegen",
    onCreated,
    onCancel,
}: DriverCreateFormProps) => {
    const fieldId = useId();
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [licenceExpires, setLicenceExpires] = useState("");
    const [licenceChecked, setLicenceChecked] = useState("");
    const [errors, setErrors] = useState<{
        name?: string;
        phone?: string;
        form?: string;
    }>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        const fieldErrors = validateDriverFields(name, phone);
        if (Object.keys(fieldErrors).length > 0) {
            setErrors(fieldErrors);
            return;
        }

        setIsSubmitting(true);
        setErrors({});

        try {
            const created = await createDriver({
                name: name.trim(),
                phone: phone.trim() === "" ? null : phone.trim(),
                licence_expires_on:
                    licenceExpires === "" ? null : licenceExpires,
                licence_checked_on:
                    licenceChecked === "" ? null : licenceChecked,
            });
            onCreated(created);
        } catch (caught) {
            if (caught instanceof ApiError) {
                const fields = caught.fields as
                    | Record<string, string | undefined>
                    | undefined;
                setErrors({
                    name: fields?.name,
                    phone: fields?.phone,
                    form: caught.message,
                });
            } else {
                setErrors({
                    form: "Fahrer konnte nicht angelegt werden.",
                });
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <div className={styles.field}>
                <label htmlFor={`${fieldId}-name`}>Name</label>
                <Input
                    id={`${fieldId}-name`}
                    type="text"
                    size="md"
                    fullWidth
                    maxLength={DRIVER_NAME_MAX}
                    value={name}
                    onChange={(event) => {
                        setName(event.target.value);
                        setErrors((current) => ({
                            ...current,
                            name: undefined,
                            form: undefined,
                        }));
                    }}
                    aria-invalid={errors.name !== undefined}
                />
                {errors.name && (
                    <p className={styles.error} role="alert">
                        {errors.name}
                    </p>
                )}
            </div>

            <div className={styles.field}>
                <label htmlFor={`${fieldId}-phone`}>Telefon</label>
                <Input
                    id={`${fieldId}-phone`}
                    type="tel"
                    size="md"
                    fullWidth
                    maxLength={DRIVER_PHONE_MAX}
                    value={phone}
                    onChange={(event) => {
                        setPhone(event.target.value);
                        setErrors((current) => ({
                            ...current,
                            phone: undefined,
                            form: undefined,
                        }));
                    }}
                    aria-invalid={errors.phone !== undefined}
                />
                {errors.phone && (
                    <p className={styles.error} role="alert">
                        {errors.phone}
                    </p>
                )}
            </div>

            <div className={styles.field}>
                <label htmlFor={`${fieldId}-licence-expires`}>
                    Führerschein gültig bis
                </label>
                <Input
                    id={`${fieldId}-licence-expires`}
                    type="date"
                    size="md"
                    fullWidth
                    value={licenceExpires}
                    onChange={(event) => {
                        setLicenceExpires(event.target.value);
                        setErrors((current) => ({
                            ...current,
                            form: undefined,
                        }));
                    }}
                />
            </div>

            <div className={styles.field}>
                <label htmlFor={`${fieldId}-licence-checked`}>
                    Führerschein kontrolliert am
                </label>
                <Input
                    id={`${fieldId}-licence-checked`}
                    type="date"
                    size="md"
                    fullWidth
                    value={licenceChecked}
                    onChange={(event) => {
                        setLicenceChecked(event.target.value);
                        setErrors((current) => ({
                            ...current,
                            form: undefined,
                        }));
                    }}
                />
            </div>

            {errors.form && !errors.name && !errors.phone && (
                <p className={styles.error} role="alert">
                    {errors.form}
                </p>
            )}

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
