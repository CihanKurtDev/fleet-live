import { useRef, useState, type ReactNode } from "react";
import {
    dueLeadDaysSchema,
    dueRule,
    licenceCheckMonthsSchema,
    type DueSettings,
} from "@fleet-live/shared";

import { ApiError } from "../../api/client";
import { useAuth } from "../../hooks/useAuth";
import { useDueSettings } from "../../hooks/useDueSettings";
import { formatCount } from "../../utils/formatCount";
import { TableFilterBar } from "../ui/Table/TableFilterBar";
import bar from "../ui/Table/TableFilterBar.module.scss";
import styles from "./DueTable.module.scss";

interface FilterChip {
    id: string;
    displayText: string;
    count?: number;
}

interface DueSettingsFormProps {
    onSaved: () => void;
    standFilters: FilterChip[];
    activeStand: string | null;
    onStand: (id: string | null) => void;
    kindFilters: FilterChip[];
    activeKind: string | null;
    onKind: (id: string | null) => void;
    allCount?: number;
    leadDays: number;
    checkMonths: number;
}

type Draft = {
    key: string;
    lead: string;
    months: string;
};

type FieldName = "lead" | "months";

const CATALOG_LEAD = dueRule("hu").lead_days;
const CATALOG_MONTHS = dueRule("licence_check").interval_months ?? 6;

function parseWhole(raw: string): number | "invalid" {
    const trimmed = raw.trim();

    if (!/^\d+$/.test(trimmed)) {
        return "invalid";
    }

    return Number(trimmed);
}

function settingsKey(settings: DueSettings): string {
    return [
        settings.lead_days,
        settings.check_months,
        settings.due_lead_days ?? "",
        settings.licence_check_months ?? "",
    ].join("|");
}

function chipClass(active: boolean, field = false): string {
    const names = [bar.chip];

    if (active) {
        names.push(bar.chipActive);
    }

    if (field) {
        names.push(styles.chipField);
    }

    return names.join(" ");
}

function PlainChip({
    active,
    label,
    count,
    onSelect,
}: {
    active: boolean;
    label: string;
    count?: number;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            className={chipClass(active)}
            aria-pressed={active}
            onClick={onSelect}
        >
            <span>{label}</span>
            {count !== undefined && (
                <span className={bar.count}>{formatCount(count)}</span>
            )}
        </button>
    );
}

function NumberChip({
    active,
    phrase,
    before,
    after,
    count,
    value,
    inputId,
    inputLabel,
    disabled,
    invalid,
    describedBy,
    onSelect,
    onChange,
    onCommit,
}: {
    active: boolean;
    phrase: string;
    before: string;
    after: string | null;
    count?: number;
    value: string;
    inputId: string;
    inputLabel: string;
    disabled: boolean;
    invalid: boolean;
    describedBy?: string;
    onSelect: () => void;
    onChange: (value: string) => void;
    onCommit: () => void;
}) {
    const named =
        count === undefined ? phrase : `${phrase}, ${formatCount(count)}`;

    return (
        <div
            className={chipClass(active, true)}
            onClick={(event) => {
                if (event.target instanceof HTMLInputElement) {
                    return;
                }

                onSelect();
            }}
        >
            <button
                type="button"
                className={styles.chipHit}
                aria-pressed={active}
                aria-label={named}
            >
                {before}
            </button>
            <input
                id={inputId}
                className={
                    invalid
                        ? `${styles.chipInput} ${styles.chipInputInvalid}`
                        : styles.chipInput
                }
                type="text"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                value={value}
                disabled={disabled}
                aria-label={inputLabel}
                aria-invalid={invalid}
                aria-describedby={describedBy}
                onChange={(event) => onChange(event.target.value)}
                onBlur={onCommit}
                onKeyDown={(event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        onCommit();
                    }
                }}
            />
            <span className={`${styles.chipHit} ${styles.chipHitEnd}`}>
                {after}
                {count !== undefined && (
                    <span className={bar.count}>{formatCount(count)}</span>
                )}
            </span>
        </div>
    );
}

function MobileChoices({
    label,
    value,
    onChange,
    children,
    field,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    children: ReactNode;
    field: ReactNode;
}) {
    return (
        <div className={styles.mobileRow}>
            <select
                className={styles.mobileSelect}
                aria-label={label}
                value={value}
                onChange={(event) => onChange(event.target.value)}
            >
                {children}
            </select>
            {field}
        </div>
    );
}

export const DueSettingsForm = ({
    onSaved,
    standFilters,
    activeStand,
    onStand,
    kindFilters,
    activeKind,
    onKind,
    allCount,
    leadDays,
    checkMonths,
}: DueSettingsFormProps) => {
    const { user } = useAuth();
    const canWrite = user?.role === "dispatcher";
    const { settings, error: loadError, save } = useDueSettings();
    const [draft, setDraft] = useState<Draft>({
        key: "",
        lead: "",
        months: "",
    });
    const [leadError, setLeadError] = useState<string | null>(null);
    const [monthsError, setMonthsError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const chain = useRef<Promise<void>>(Promise.resolve());

    const key = settings ? settingsKey(settings) : "";
    if (settings && draft.key !== key) {
        setDraft({
            key,
            lead: String(settings.lead_days),
            months: String(settings.check_months),
        });
        setLeadError(null);
        setMonthsError(null);
    }

    const ready = settings !== null && draft.key === key;
    const leadValue =
        settings === null
            ? String(leadDays)
            : ready
              ? draft.lead
              : String(settings.lead_days);
    const monthsValue =
        settings === null
            ? String(checkMonths)
            : ready
              ? draft.months
              : String(settings.check_months);
    const leadNumber = parseWhole(leadValue);
    const monthsNumber = parseWhole(monthsValue);
    const showHeute = leadNumber === 0;
    const checkOff = monthsNumber === 0;

    const persist = (
        field: FieldName,
        input: {
            due_lead_days?: number | null;
            licence_check_months?: number | null;
        },
    ) => {
        const run = chain.current.then(async () => {
            savingRef.current = true;
            setSaving(true);

            if (field === "lead") {
                setLeadError(null);
            } else {
                setMonthsError(null);
            }

            try {
                await save(input);
                onSaved();
            } catch (caught: unknown) {
                const message =
                    caught instanceof ApiError
                        ? caught.message
                        : "Einstellungen konnten nicht gespeichert werden.";

                if (field === "lead") {
                    setLeadError(message);
                } else {
                    setMonthsError(message);
                }
            } finally {
                savingRef.current = false;
                setSaving(false);
            }
        });

        chain.current = run.then(
            () => undefined,
            () => undefined,
        );
    };

    const commitLead = () => {
        if (!settings || !ready || savingRef.current) {
            return;
        }

        const parsed = parseWhole(draft.lead);

        if (parsed === "invalid") {
            setLeadError("Ganze Zahl ab 0.");
            return;
        }

        const checked = dueLeadDaysSchema.safeParse(parsed);

        if (!checked.success) {
            setLeadError(checked.error.issues[0]?.message ?? "Ungültige Eingabe.");
            return;
        }

        setLeadError(null);

        if (parsed === settings.lead_days) {
            return;
        }

        persist("lead", {
            due_lead_days: parsed === CATALOG_LEAD ? null : parsed,
        });
    };

    const commitMonths = () => {
        if (!settings || !ready || savingRef.current) {
            return;
        }

        const parsed = parseWhole(draft.months);

        if (parsed === "invalid") {
            setMonthsError("Ganze Zahl ab 0.");
            return;
        }

        const checked = licenceCheckMonthsSchema.safeParse(parsed);

        if (!checked.success) {
            setMonthsError(
                checked.error.issues[0]?.message ?? "Ungültige Eingabe.",
            );
            return;
        }

        setMonthsError(null);

        if (parsed === settings.check_months) {
            return;
        }

        persist("months", {
            licence_check_months: parsed === CATALOG_MONTHS ? null : parsed,
        });
    };

    const leadPhrase = showHeute ? "Heute" : `In ${leadValue} Tagen`;
    const monthsPhrase = checkOff
        ? "Kontrolle aus"
        : `Kontrolle, ${monthsValue} Monate`;

    if (!canWrite) {
        return (
            <div className={styles.filters}>
                <TableFilterBar
                    filters={standFilters}
                    activeFilterId={activeStand}
                    onFilterChange={onStand}
                    showAll={false}
                    groupLabel="Stand"
                    ariaLabel="Stand"
                />
                <TableFilterBar
                    filters={kindFilters}
                    activeFilterId={activeKind}
                    onFilterChange={onKind}
                    allCount={allCount}
                    allLabel="Alle"
                    groupLabel="Art"
                    ariaLabel="Art"
                />
                {loadError && (
                    <p className={styles.settingError} role="alert">
                        {loadError}
                    </p>
                )}
            </div>
        );
    }

    const mobileNumber = (
        id: string,
        label: string,
        value: string,
        unit: string,
        invalid: boolean,
        describedBy: string | undefined,
        onChange: (value: string) => void,
        onCommit: () => void,
    ) => (
        <label className={styles.mobileField} htmlFor={id}>
            <input
                id={id}
                className={
                    invalid
                        ? `${styles.mobileInput} ${styles.chipInputInvalid}`
                        : styles.mobileInput
                }
                type="text"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                value={value}
                disabled={!ready || saving}
                aria-label={label}
                aria-invalid={invalid}
                aria-describedby={describedBy}
                onChange={(event) => onChange(event.target.value)}
                onBlur={onCommit}
                onKeyDown={(event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        onCommit();
                    }
                }}
            />
            <span>{unit}</span>
        </label>
    );

    return (
        <div className={styles.filters}>
            <div className={bar.group}>
                <p className={bar.groupLabel}>Stand</p>
                <MobileChoices
                    label="Stand"
                    value={activeStand ?? "overdue"}
                    onChange={onStand}
                    field={mobileNumber(
                        "due-lead-days-mobile",
                        "Vorlauf in Tagen",
                        leadValue,
                        showHeute ? "Heute" : "Tage",
                        leadError !== null,
                        leadError ? "due-lead-error" : undefined,
                        (value) => {
                            setDraft((current) => ({ ...current, lead: value }));
                            setLeadError(null);
                        },
                        commitLead,
                    )}
                >
                    {standFilters.map((filter) => (
                        <option key={filter.id} value={filter.id}>
                            {filter.displayText}
                            {filter.count !== undefined
                                ? ` (${formatCount(filter.count)})`
                                : ""}
                        </option>
                    ))}
                </MobileChoices>
                <div className={bar.filterBar} role="group" aria-label="Stand">
                    {standFilters.map((filter) =>
                        filter.id === "soon" ? (
                            <NumberChip
                                key={filter.id}
                                active={activeStand === "soon"}
                                phrase={leadPhrase}
                                before={showHeute ? "Heute" : "In"}
                                after={showHeute ? null : "Tagen"}
                                count={filter.count}
                                value={leadValue}
                                inputId="due-lead-days"
                                inputLabel="Vorlauf in Tagen"
                                disabled={!ready || saving}
                                invalid={leadError !== null}
                                describedBy={
                                    leadError ? "due-lead-error" : undefined
                                }
                                onSelect={() =>
                                    onStand(
                                        activeStand === "soon" ? null : "soon",
                                    )
                                }
                                onChange={(value) => {
                                    setDraft((current) => ({
                                        ...current,
                                        lead: value,
                                    }));
                                    setLeadError(null);
                                }}
                                onCommit={commitLead}
                            />
                        ) : (
                            <PlainChip
                                key={filter.id}
                                active={filter.id === activeStand}
                                label={filter.displayText}
                                count={filter.count}
                                onSelect={() =>
                                    onStand(
                                        filter.id === activeStand
                                            ? null
                                            : filter.id,
                                    )
                                }
                            />
                        ),
                    )}
                </div>
                {leadError && (
                    <p
                        id="due-lead-error"
                        className={styles.settingError}
                        role="alert"
                    >
                        {leadError}
                    </p>
                )}
            </div>

            <div className={bar.group}>
                <p className={bar.groupLabel}>Art</p>
                <MobileChoices
                    label="Art"
                    value={activeKind ?? ""}
                    onChange={(value) => onKind(value === "" ? null : value)}
                    field={mobileNumber(
                        "due-check-months-mobile",
                        "Kontrollintervall in Monaten",
                        monthsValue,
                        checkOff ? "aus" : "Monate",
                        monthsError !== null,
                        monthsError ? "due-months-error" : undefined,
                        (value) => {
                            setDraft((current) => ({
                                ...current,
                                months: value,
                            }));
                            setMonthsError(null);
                        },
                        commitMonths,
                    )}
                >
                    <option value="">
                        Alle
                        {allCount !== undefined
                            ? ` (${formatCount(allCount)})`
                            : ""}
                    </option>
                    {kindFilters.map((filter) => (
                        <option key={filter.id} value={filter.id}>
                            {filter.displayText}
                            {filter.count !== undefined
                                ? ` (${formatCount(filter.count)})`
                                : ""}
                        </option>
                    ))}
                </MobileChoices>
                <div className={bar.filterBar} role="group" aria-label="Art">
                    <PlainChip
                        active={activeKind === null}
                        label="Alle"
                        count={allCount}
                        onSelect={() => onKind(null)}
                    />
                    {kindFilters.map((filter) =>
                        filter.id === "licence_check" ? (
                            <NumberChip
                                key={filter.id}
                                active={activeKind === "licence_check"}
                                phrase={monthsPhrase}
                                before="Kontrolle"
                                after={checkOff ? "aus" : "Monate"}
                                count={filter.count}
                                value={monthsValue}
                                inputId="due-check-months"
                                inputLabel="Kontrollintervall in Monaten"
                                disabled={!ready || saving}
                                invalid={monthsError !== null}
                                describedBy={
                                    monthsError ? "due-months-error" : undefined
                                }
                                onSelect={() =>
                                    onKind(
                                        activeKind === "licence_check"
                                            ? null
                                            : "licence_check",
                                    )
                                }
                                onChange={(value) => {
                                    setDraft((current) => ({
                                        ...current,
                                        months: value,
                                    }));
                                    setMonthsError(null);
                                }}
                                onCommit={commitMonths}
                            />
                        ) : (
                            <PlainChip
                                key={filter.id}
                                active={filter.id === activeKind}
                                label={filter.displayText}
                                count={filter.count}
                                onSelect={() =>
                                    onKind(
                                        filter.id === activeKind
                                            ? null
                                            : filter.id,
                                    )
                                }
                            />
                        ),
                    )}
                </div>
                {monthsError && (
                    <p
                        id="due-months-error"
                        className={styles.settingError}
                        role="alert"
                    >
                        {monthsError}
                    </p>
                )}
            </div>

            {loadError && !leadError && !monthsError && (
                <p className={styles.settingError} role="alert">
                    {loadError}
                </p>
            )}
        </div>
    );
};
