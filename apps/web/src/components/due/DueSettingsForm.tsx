import { useEffect, useRef, useState, type ReactNode } from "react";
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
    onShowChecks: () => void;
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

function leadRule(days: number): string {
    if (days === 0) {
        return "Nur Termine, die heute fällig sind. Was früher fällig war, bleibt bei Überfällig.";
    }

    return `Termine, die in den nächsten ${days} Tagen fällig werden. Was schon überfällig ist, bleibt bei Überfällig.`;
}

function monthsRule(months: number): string {
    if (months === 0) {
        return "Führerscheinkontrolle ist aus. Diese Zeilen fehlen in der Liste.";
    }

    return `Eine Kontrolle wird ${months} Monate nach dem letzten Kontrolldatum fällig.`;
}

function standName(active: string | null, lead: number): string {
    if (active === "soon") {
        return lead === 0 ? "Heute" : `In ${lead} Tagen`;
    }

    if (active === "missing") {
        return "Datum fehlt";
    }

    return "Überfällig";
}

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
    onShowChecks,
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
    const [savingField, setSavingField] = useState<FieldName | null>(null);
    const [result, setResult] = useState<{
        field: FieldName;
        value: number;
        before: number | null;
    } | null>(null);
    const chain = useRef<Promise<void>>(Promise.resolve());
    const leadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const monthsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingLead = useRef<number | null>(null);
    const pendingMonths = useRef<number | null>(null);
    const settingsRef = useRef(settings);
    const draftRef = useRef(draft);
    const commitLeadRef = useRef<() => void>(() => {});
    const commitMonthsRef = useRef<() => void>(() => {});
    settingsRef.current = settings;
    draftRef.current = draft;

    const soonCount = standFilters.find((item) => item.id === "soon")?.count;
    const checkCount = kindFilters.find(
        (item) => item.id === "licence_check",
    )?.count;
    const soonCountRef = useRef(soonCount);
    const checkCountRef = useRef(checkCount);
    const standRef = useRef(activeStand);
    soonCountRef.current = soonCount;
    checkCountRef.current = checkCount;
    standRef.current = activeStand;

    const key = settings ? settingsKey(settings) : "";
    if (settings && draft.key !== key) {
        setDraft({
            key,
            lead:
                leadTimer.current !== null || pendingLead.current !== null
                    ? draft.lead
                    : String(settings.lead_days),
            months:
                monthsTimer.current !== null || pendingMonths.current !== null
                    ? draft.months
                    : String(settings.check_months),
        });
        setLeadError(null);
        setMonthsError(null);
    }

    useEffect(() => {
        return () => {
            if (leadTimer.current) {
                clearTimeout(leadTimer.current);
            }

            if (monthsTimer.current) {
                clearTimeout(monthsTimer.current);
            }
        };
    }, []);

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
        applied: number,
        before: number | null,
    ) => {
        const run = chain.current.then(async () => {
            setSavingField(field);

            if (field === "lead") {
                setLeadError(null);
            } else {
                setMonthsError(null);
            }

            try {
                await save(input);

                if (field === "lead") {
                    if (pendingLead.current === applied) {
                        pendingLead.current = null;
                    }

                    onStand("soon");
                } else {
                    if (pendingMonths.current === applied) {
                        pendingMonths.current = null;
                    }

                    onShowChecks();
                }

                setResult({ field, value: applied, before });
                onSaved();
            } catch (caught: unknown) {
                if (field === "lead" && pendingLead.current === applied) {
                    pendingLead.current = null;
                }

                if (field === "months" && pendingMonths.current === applied) {
                    pendingMonths.current = null;
                }

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
                setSavingField((current) => (current === field ? null : current));
            }
        });

        chain.current = run.then(
            () => undefined,
            () => undefined,
        );
    };

    const commitLead = () => {
        const current = settingsRef.current;

        if (!current || draftRef.current.lead === "") {
            return;
        }

        const parsed = parseWhole(draftRef.current.lead);

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

        if (parsed === (pendingLead.current ?? current.lead_days)) {
            return;
        }

        pendingLead.current = parsed;
        persist(
            "lead",
            { due_lead_days: parsed === CATALOG_LEAD ? null : parsed },
            parsed,
            soonCountRef.current ?? null,
        );
    };

    const commitMonths = () => {
        const current = settingsRef.current;

        if (!current || draftRef.current.months === "") {
            return;
        }

        const parsed = parseWhole(draftRef.current.months);

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

        if (parsed === (pendingMonths.current ?? current.check_months)) {
            return;
        }

        pendingMonths.current = parsed;
        persist(
            "months",
            {
                licence_check_months:
                    parsed === CATALOG_MONTHS ? null : parsed,
            },
            parsed,
            standRef.current === "overdue"
                ? (checkCountRef.current ?? null)
                : null,
        );
    };

    commitLeadRef.current = commitLead;
    commitMonthsRef.current = commitMonths;

    const schedule = (field: FieldName) => {
        const timer = field === "lead" ? leadTimer : monthsTimer;

        if (timer.current) {
            clearTimeout(timer.current);
        }

        timer.current = setTimeout(() => {
            timer.current = null;

            if (field === "lead") {
                commitLeadRef.current();
            } else {
                commitMonthsRef.current();
            }
        }, 450);
    };

    const flush = (field: FieldName) => {
        const timer = field === "lead" ? leadTimer : monthsTimer;

        if (timer.current) {
            clearTimeout(timer.current);
            timer.current = null;
        }

        if (field === "lead") {
            commitLeadRef.current();
        } else {
            commitMonthsRef.current();
        }
    };

    const leadDirty =
        leadNumber !== "invalid" &&
        settings !== null &&
        leadNumber !== settings.lead_days;
    const monthsDirty =
        monthsNumber !== "invalid" &&
        settings !== null &&
        monthsNumber !== settings.check_months;
    const leadHint =
        leadNumber === "invalid"
            ? null
            : leadRule(leadNumber) +
              (leadDirty || soonCount === undefined
                  ? ""
                  : leadNumber === 0
                    ? ` ${formatCount(soonCount)} Termine sind heute fällig.`
                    : ` ${formatCount(soonCount)} Termine fallen in diese ${leadNumber} Tage.`);
    const monthsHint =
        monthsNumber === "invalid"
            ? null
            : monthsRule(monthsNumber) +
              (monthsDirty || checkCount === undefined
                  ? ""
                  : ` Unter „${standName(activeStand, leadNumber === "invalid" ? leadDays : leadNumber)}“ sind das ${formatCount(checkCount)} Zeilen.`);
    const leadCaughtUp = settings !== null && leadDays === settings.lead_days;
    const monthsCaughtUp =
        settings !== null && checkMonths === settings.check_months;
    const leadLive =
        savingField === "lead" || (result?.field === "lead" && !leadCaughtUp)
            ? "Die Liste wird angepasst…"
            : result?.field === "lead" &&
                leadCaughtUp &&
                !leadDirty &&
                soonCount !== undefined
              ? result.before !== null && result.before !== soonCount
                  ? `Vorher ${formatCount(result.before)} Termine, jetzt ${formatCount(soonCount)}. Die Liste zeigt genau diese.`
                  : `Weiterhin ${formatCount(soonCount)} Termine. Die Liste zeigt sie.`
              : "";
    const monthsLive =
        savingField === "months" ||
        (result?.field === "months" && !monthsCaughtUp)
            ? "Die Liste wird angepasst…"
            : result?.field === "months" &&
                monthsCaughtUp &&
                !monthsDirty &&
                checkCount !== undefined
              ? result.value === 0
                  ? "Kontrolle ist aus. Die Liste zeigt diese Zeilen nicht mehr."
                  : result.before !== null && result.before !== checkCount
                    ? `Vorher ${formatCount(result.before)} überfällige Kontrollen, jetzt ${formatCount(checkCount)}. Die Liste zeigt sie.`
                    : result.before !== null
                      ? `Weiterhin ${formatCount(checkCount)} überfällige Kontrollen. Die Liste zeigt sie.`
                      : `Die Liste zeigt ${formatCount(checkCount)} überfällige Kontrollen.`
              : "";

    const leadPhrase = showHeute ? "Heute" : `In ${leadValue} Tagen`;
    const monthsPhrase = checkOff
        ? "Kontrolle aus"
        : `Kontrolle, ${monthsValue} Monate`;

    if (!canWrite) {
        const viewerSoon = standFilters.find((item) => item.id === "soon")?.count;
        const viewerChecks = kindFilters.find(
            (item) => item.id === "licence_check",
        )?.count;

        return (
            <div className={styles.filters}>
                <div className={styles.settingGroup}>
                    <TableFilterBar
                        filters={standFilters}
                        activeFilterId={activeStand}
                        onFilterChange={onStand}
                        showAll={false}
                        groupLabel="Stand"
                        ariaLabel="Stand"
                    />
                    <p className={styles.settingHint}>
                        {leadRule(leadDays)}
                        {viewerSoon === undefined
                            ? ""
                            : leadDays === 0
                              ? ` ${formatCount(viewerSoon)} Termine sind heute fällig.`
                              : ` ${formatCount(viewerSoon)} Termine fallen in diese ${leadDays} Tage.`}
                    </p>
                </div>
                <div className={styles.settingGroup}>
                    <TableFilterBar
                        filters={kindFilters}
                        activeFilterId={activeKind}
                        onFilterChange={onKind}
                        allCount={allCount}
                        allLabel="Alle"
                        groupLabel="Art"
                        ariaLabel="Art"
                    />
                    <p className={styles.settingHint}>
                        {monthsRule(checkMonths)}
                        {viewerChecks === undefined
                            ? ""
                            : ` Unter „${standName(activeStand, leadDays)}“ sind das ${formatCount(viewerChecks)} Zeilen.`}
                    </p>
                </div>
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
                disabled={!ready}
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
            <div className={`${bar.group} ${styles.bound}`}>
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
                        leadError
                            ? "due-lead-hint due-lead-error"
                            : "due-lead-hint",
                        (value) => {
                            setDraft((current) => ({ ...current, lead: value }));
                            setLeadError(null);
                            schedule("lead");
                        },
                        () => flush("lead"),
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
                                disabled={!ready}
                                invalid={leadError !== null}
                                describedBy={
                                    leadError
                                        ? "due-lead-hint due-lead-error"
                                        : "due-lead-hint"
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
                                    schedule("lead");
                                }}
                                onCommit={() => flush("lead")}
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
                {leadHint && (
                    <p id="due-lead-hint" className={styles.settingHint}>
                        {leadHint}
                    </p>
                )}
                <p className={styles.settingResult} role="status">
                    {leadLive}
                </p>
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

            <div className={`${bar.group} ${styles.bound}`}>
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
                        monthsError
                            ? "due-months-hint due-months-error"
                            : "due-months-hint",
                        (value) => {
                            setDraft((current) => ({
                                ...current,
                                months: value,
                            }));
                            setMonthsError(null);
                            schedule("months");
                        },
                        () => flush("months"),
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
                                disabled={!ready}
                                invalid={monthsError !== null}
                                describedBy={
                                    monthsError
                                        ? "due-months-hint due-months-error"
                                        : "due-months-hint"
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
                                    schedule("months");
                                }}
                                onCommit={() => flush("months")}
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
                {monthsHint && (
                    <p id="due-months-hint" className={styles.settingHint}>
                        {monthsHint}
                    </p>
                )}
                <p className={styles.settingResult} role="status">
                    {monthsLive}
                </p>
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
