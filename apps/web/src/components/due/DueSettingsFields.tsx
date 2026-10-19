import { useState } from "react";
import {
    dueLeadDaysSchema,
    dueRule,
    licenceCheckMonthsSchema,
    type DueSettings,
} from "@fleet-live/shared";

import { ApiError } from "../../api/client";
import { useAuth } from "../../hooks/useAuth";
import { useDueSettings } from "../../hooks/useDueSettings";
import { FieldError } from "../ui/FieldError/FieldError";
import { fieldAria } from "../ui/FieldError/fieldAria";
import { Input } from "../ui/Input/Input";
import styles from "./DueBoard.module.scss";

type Field = "lead" | "months";

const CATALOG_LEAD = dueRule("hu").lead_days;
const CATALOG_MONTHS = dueRule("licence_check").interval_months ?? 6;

interface DueSettingsFieldsProps {
    onSaved: () => void;
}

function parseWhole(raw: string): number | null {
    return /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null;
}

/** Company lead days and licence-check interval. Dispatcher edits, viewer reads. */
export const DueSettingsFields = ({ onSaved }: DueSettingsFieldsProps) => {
    const { user } = useAuth();
    const canWrite = user?.role === "dispatcher";
    const { settings, error: loadError, save } = useDueSettings();
    const [draft, setDraft] = useState<{ lead: string; months: string } | null>(
        null,
    );
    const [errors, setErrors] = useState<Record<Field, string | null>>({
        lead: null,
        months: null,
    });
    const [saving, setSaving] = useState<Field | null>(null);

    if (!settings) {
        return loadError ? (
            <p className={styles.fieldError} role="alert">
                {loadError}
            </p>
        ) : null;
    }

    if (!canWrite) {
        return (
            <dl className={styles.settingsRead}>
                <dt>Vorlauf „bald fällig“</dt>
                <dd>{settings.lead_days} Tage</dd>
                <dt>Kontrolle alle</dt>
                <dd>
                    {settings.check_months === 0
                        ? "aus"
                        : `${settings.check_months} Monate`}
                </dd>
            </dl>
        );
    }

    const values = draft ?? {
        lead: String(settings.lead_days),
        months: String(settings.check_months),
    };

    const commit = async (field: Field) => {
        const raw = field === "lead" ? values.lead : values.months;
        const parsed = parseWhole(raw);
        const current: number =
            field === "lead" ? settings.lead_days : settings.check_months;
        const schema =
            field === "lead" ? dueLeadDaysSchema : licenceCheckMonthsSchema;
        const checked =
            parsed === null ? null : schema.safeParse(parsed);

        if (parsed === null || !checked?.success) {
            setErrors((prev) => ({
                ...prev,
                [field]:
                    checked && !checked.success
                        ? (checked.error.issues[0]?.message ?? "Ungültige Eingabe.")
                        : "Ganze Zahl ab 0.",
            }));
            return;
        }

        setErrors((prev) => ({ ...prev, [field]: null }));

        if (parsed === current) {
            return;
        }

        const input: Partial<
            Pick<DueSettings, "due_lead_days" | "licence_check_months">
        > =
            field === "lead"
                ? { due_lead_days: parsed === CATALOG_LEAD ? null : parsed }
                : {
                      licence_check_months:
                          parsed === CATALOG_MONTHS ? null : parsed,
                  };

        setSaving(field);

        try {
            await save(input);
            setDraft(null);
            onSaved();
        } catch (caught: unknown) {
            setErrors((prev) => ({
                ...prev,
                [field]:
                    caught instanceof ApiError
                        ? caught.message
                        : "Einstellung konnte nicht gespeichert werden.",
            }));
        } finally {
            setSaving(null);
        }
    };

    const field = (
        name: Field,
        label: string,
        unit: string,
        ariaLabel: string,
    ) => (
        <div className={styles.settingRow}>
            <label className={styles.settingLabel} htmlFor={`due-${name}`}>
                {label}
            </label>
            <span className={styles.settingUnit}>{unit}</span>
            <Input
                id={`due-${name}`}
                type="number"
                size="sm"
                min={0}
                inputMode="numeric"
                className={styles.settingInput}
                aria-label={ariaLabel}
                {...fieldAria(`due-${name}`, errors[name])}
                aria-busy={saving === name}
                value={name === "lead" ? values.lead : values.months}
                onChange={(event) =>
                    setDraft({ ...values, [name]: event.target.value })
                }
                onBlur={() => void commit(name)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        void commit(name);
                    }
                }}
            />
            <FieldError fieldId={`due-${name}`} className={styles.fieldError}>
                {errors[name]}
            </FieldError>
        </div>
    );

    return (
        <div className={styles.settings}>
            {field("lead", "Vorlauf „bald fällig“", "Tage", "Vorlauf in Tagen")}
            {field(
                "months",
                "Kontrolle alle",
                "Monate",
                "Kontrollabstand in Monaten, 0 schaltet sie aus",
            )}
        </div>
    );
};
