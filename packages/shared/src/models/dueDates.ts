/**
 * Kalenderfristen für die Schicht, nicht für die Inbox.
 * HU, UVV und Führerschein-Ablauf: leer ist „ohne Datum“, nicht überfällig.
 * Führerscheinkontrolle: leer oder älter als 6 Monate ist überfällig.
 * „Bald“ heißt fällig innerhalb der nächsten 30 Tage, inklusive heute.
 * Verglichen wird das UTC-Kalenderdatum als JJJJ-MM-TT.
 */

import { z } from "zod";
import {
    INTERNAL_DUE_NOTICE,
    dueRule,
    type DueRuleKind,
} from "./dueRules";
import { emptyToUndefined, firstQueryString } from "./queryPreprocess";
import { VEHICLE_PAGE_LIMITS } from "./vehicleQuery";
import type { WorkshopSummary } from "./workshop";

export const DUE_SOON_DAYS = 30;
export const LICENCE_CHECK_MONTHS = 6;

export const DUE_KINDS = [
    "hu",
    "uvv",
    "licence_expiry",
    "licence_check",
] as const;

export type DueKind = (typeof DUE_KINDS)[number];

export type DueCalendarState = "overdue" | "soon" | "ok" | "missing";

export type DueAttention = "overdue" | "soon";

export type DueReminder = {
    kind: DueKind;
    state: DueAttention;
    /** Nächster Termin. `null` nur bei fehlender Führerscheinkontrolle. */
    due_on: string | null;
    vehicle_id: number | null;
    driver_id: number | null;
    /** Kennzeichen oder Fahrername. */
    label: string;
};

export type DueMissingCounts = {
    hu: number;
    uvv: number;
    licence_expiry: number;
};

/** Zähler der Schicht. Ohne Zeilen. */
export type DueCounts = {
    overdue: number;
    soon: number;
    missing: DueMissingCounts;
};

export type DueSummary = DueCounts & {
    items: DueReminder[];
};

export const DUE_LIST_STATES = ["overdue", "soon", "missing"] as const;

export type DueListState = (typeof DUE_LIST_STATES)[number];

export const DUE_SORT_KEYS = ["due_on", "label", "kind"] as const;

export type DueSortKey = (typeof DUE_SORT_KEYS)[number];

/** Anzeige der Art, auch die Sortierung der Liste. */
export const DUE_KIND_LABELS: Record<DueKind, string> = {
    hu: "HU",
    uvv: "UVV",
    licence_expiry: "Führerschein",
    licence_check: "Kontrolle",
};

/** Eine Zeile der Fristenliste. `missing` ist ein leeres Feld. */
export type DueListItem = {
    kind: DueKind;
    state: DueListState;
    due_on: string | null;
    vehicle_id: number | null;
    driver_id: number | null;
    label: string;
    /** Wie das Datum zustande kommt. Fehlt bei der alten Listenrechnung. */
    explanation?: DueExplanation;
    /** HU/UVV-Zeilen: offener Werkstatt-Aufenthalt des Fahrzeugs (jeder Grund), sonst `null`. */
    workshop?: WorkshopSummary | null;
};

export type DueListCounts = {
    overdue: number;
    soon: number;
    missing: number;
};

export type DueKindCounts = {
    all: number;
    hu: number;
    uvv: number;
    licence_expiry: number;
    licence_check: number;
};

export type DueListMeta = {
    page: number;
    limit: number;
    total: number;
    pageCount: number;
    /** Stand für die aktuelle Suche, ohne Art-Filter. */
    counts: DueListCounts;
    /** Arten für den aktuellen Stand und die Suche. */
    kind_counts: DueKindCounts;
    /** Aufgelöster Vorlauf, mit dem diese Liste gezählt wurde. */
    lead_days?: number;
    /** Aufgelöster Kontrollabstand. `0` heißt, die Kontrolle ist aus. */
    licence_check_months?: number;
    /**
     * Aktive Fahrzeuge und Fahrer der Firma, unabhängig von Stand und Suche.
     * Beide `0`: die Firma ist leer, „Nichts offen“ wäre falsch.
     */
    subjects?: { vehicles: number; drivers: number };
};

export type DueListResponse = {
    data: DueListItem[];
    meta: DueListMeta;
};

export type VehicleDueInput = {
    id: number;
    license_plate: string;
    hu_due_on: string | null;
    uvv_due_on: string | null;
};

export type DriverDueInput = {
    id: number;
    name: string;
    licence_expires_on: string | null;
    licence_checked_on: string | null;
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function utcTodayIso(now = new Date()): string {
    return now.toISOString().slice(0, 10);
}

/** Kalendertag in Europe/Berlin. `GET /api/due` und die Schichtzähler nutzen dieses Datum. */
export function berlinTodayIso(now = new Date()): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Berlin",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(now);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;

    if (!year || !month || !day) {
        throw new Error("Berlin-Datum konnte nicht bestimmt werden.");
    }

    return `${year}-${month}-${day}`;
}

export function addIsoDays(iso: string, days: number): string {
    const parts = readIso(iso);
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
        .toISOString()
        .slice(0, 10);
}

/** Monatstag wird auf das Monatsende gekürzt (31.01. + 1 Monat = 28./29.02.). */
export function addIsoMonths(iso: string, months: number): string {
    const parts = readIso(iso);
    const cursor = new Date(Date.UTC(parts.year, parts.month - 1 + months, 1));
    const lastDay = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const day = Math.min(parts.day, lastDay);

    return new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), day),
    )
        .toISOString()
        .slice(0, 10);
}

export function classifyDueOn(
    dueOn: string | null,
    today: string,
    leadDays: number,
): DueCalendarState {
    if (dueOn === null || dueOn === "") {
        return "missing";
    }

    if (dueOn < today) {
        return "overdue";
    }

    if (dueOn <= addIsoDays(today, leadDays)) {
        return "soon";
    }

    return "ok";
}

export function classifyCalendarDate(
    dueOn: string | null,
    today: string,
): DueCalendarState {
    return classifyDueOn(dueOn, today, DUE_SOON_DAYS);
}

/** Letzter Kalendertag von `JJJJ-MM`. */
export function monthEndIso(yearMonth: string): string {
    const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);

    if (!match) {
        throw new Error("Monat als JJJJ-MM angeben.");
    }

    const year = Number(match[1]);
    const month = Number(match[2]);

    if (month < 1 || month > 12) {
        throw new Error("Monat als JJJJ-MM angeben.");
    }

    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

    return `${match[1]}-${match[2]}-${String(lastDay).padStart(2, "0")}`;
}

const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * HU gilt bis zum Monatsende. Überfällig ist erst der folgende Tag.
 * `leadDays` zählt bis zu diesem Monatsende.
 * Ein Wert, der kein `JJJJ-MM` ist, zählt als fehlendes Datum.
 */
export function classifyHuMonth(
    yearMonth: string | null,
    today: string,
    leadDays: number,
): { state: DueCalendarState; due_on: string | null } {
    if (yearMonth === null || yearMonth === "" || !YEAR_MONTH.test(yearMonth)) {
        return { state: "missing", due_on: null };
    }

    const dueOn = monthEndIso(yearMonth);

    return { state: classifyDueOn(dueOn, today, leadDays), due_on: dueOn };
}

export type UvvDueSource = "manual" | "interval" | "missing";

/**
 * Manuelles `uvv_due_on` gilt nur, wenn es nach `uvv_checked_on` liegt.
 * Sonst zählt die letzte Prüfung plus Intervall. Ohne Prüfung bleibt ein
 * allein gesetztes manuelles Datum die Fälligkeit.
 */
export function resolveUvvDue(input: {
    checkedOn: string | null;
    manualDueOn: string | null;
    intervalMonths: number;
    today: string;
}): {
    due_on: string | null;
    source: UvvDueSource;
    last_on: string | null;
    /** Prüfdatum liegt nach heute. Die Fälligkeit wird trotzdem normal gerechnet. */
    last_checked_in_future: boolean;
} {
    const checked = blankToNull(input.checkedOn);
    const manual = blankToNull(input.manualDueOn);
    const resolved = resolveUvvDueDate(checked, manual, input.intervalMonths);

    return {
        ...resolved,
        last_checked_in_future:
            resolved.last_on !== null && resolved.last_on > input.today,
    };
}

function resolveUvvDueDate(
    checked: string | null,
    manual: string | null,
    intervalMonths: number,
): { due_on: string | null; source: UvvDueSource; last_on: string | null } {
    if (checked !== null && manual !== null && manual > checked) {
        return { due_on: manual, source: "manual", last_on: checked };
    }

    if (checked !== null) {
        return {
            due_on: addIsoMonths(checked, intervalMonths),
            source: "interval",
            last_on: checked,
        };
    }

    if (manual !== null) {
        return { due_on: manual, source: "manual", last_on: null };
    }

    return { due_on: null, source: "missing", last_on: null };
}

/**
 * `intervalMonths === 0` schaltet die Kontrolle aus: keine Zeile.
 * Ohne Prüfdatum bleibt sie überfällig, solange das Intervall an ist.
 */
export function classifyLicenceInterval(input: {
    checkedOn: string | null;
    today: string;
    intervalMonths: number;
    leadDays: number;
}): {
    included: boolean;
    state: DueCalendarState;
    due_on: string | null;
    last_on: string | null;
    /** Kontrolldatum liegt nach heute. Die Fälligkeit wird trotzdem normal gerechnet. */
    last_checked_in_future: boolean;
} {
    const checked = blankToNull(input.checkedOn);
    const lastCheckedInFuture = checked !== null && checked > input.today;

    if (input.intervalMonths === 0) {
        return {
            included: false,
            state: "ok",
            due_on: null,
            last_on: checked,
            last_checked_in_future: lastCheckedInFuture,
        };
    }

    if (checked === null) {
        return {
            included: true,
            state: "overdue",
            due_on: null,
            last_on: null,
            last_checked_in_future: false,
        };
    }

    const dueOn = addIsoMonths(checked, input.intervalMonths);
    const state = classifyDueOn(dueOn, input.today, input.leadDays);

    return {
        included: true,
        state: state === "missing" ? "ok" : state,
        due_on: dueOn,
        last_on: checked,
        last_checked_in_future: lastCheckedInFuture,
    };
}

export function isDueActive(active: boolean | undefined): boolean {
    return active !== false;
}

export function classifyLicenceCheck(
    checkedOn: string | null,
    today: string,
): { state: DueCalendarState; due_on: string | null } {
    if (checkedOn === null || checkedOn === "") {
        return { state: "overdue", due_on: null };
    }

    const dueOn = addIsoMonths(checkedOn, LICENCE_CHECK_MONTHS);
    const state = classifyCalendarDate(dueOn, today);

    return {
        state: state === "missing" ? "ok" : state,
        due_on: dueOn,
    };
}

type DueCollectInput = {
    vehicles: VehicleDueInput[];
    drivers: DriverDueInput[];
    today: string;
};

function collectDue(input: DueCollectInput): {
    items: DueReminder[];
    gaps: DueListItem[];
    missing: DueMissingCounts;
} {
    const items: DueReminder[] = [];
    const gaps: DueListItem[] = [];
    const missing: DueMissingCounts = { hu: 0, uvv: 0, licence_expiry: 0 };

    for (const vehicle of input.vehicles) {
        pushCalendar(items, gaps, missing, "hu", vehicle.hu_due_on, input.today, {
            vehicle_id: vehicle.id,
            driver_id: null,
            label: vehicle.license_plate,
        });
        pushCalendar(
            items,
            gaps,
            missing,
            "uvv",
            vehicle.uvv_due_on,
            input.today,
            {
                vehicle_id: vehicle.id,
                driver_id: null,
                label: vehicle.license_plate,
            },
        );
    }

    for (const driver of input.drivers) {
        pushCalendar(
            items,
            gaps,
            missing,
            "licence_expiry",
            driver.licence_expires_on,
            input.today,
            {
                vehicle_id: null,
                driver_id: driver.id,
                label: driver.name,
            },
        );

        const check = classifyLicenceCheck(
            driver.licence_checked_on,
            input.today,
        );
        if (check.state === "overdue" || check.state === "soon") {
            items.push({
                kind: "licence_check",
                state: check.state,
                due_on: check.due_on,
                vehicle_id: null,
                driver_id: driver.id,
                label: driver.name,
            });
        }
    }

    return { items, gaps, missing };
}

export function buildDueReminders(input: DueCollectInput): DueSummary {
    const { items, missing } = collectDue(input);

    items.sort((left, right) => {
        if (left.state !== right.state) {
            return left.state === "overdue" ? -1 : 1;
        }

        const leftDue = left.due_on ?? "";
        const rightDue = right.due_on ?? "";
        if (leftDue !== rightDue) {
            return leftDue < rightDue ? -1 : 1;
        }

        const byLabel = left.label.localeCompare(right.label, "de");
        if (byLabel !== 0) {
            return byLabel;
        }

        return left.kind.localeCompare(right.kind);
    });

    return {
        overdue: items.filter((item) => item.state === "overdue").length,
        soon: items.filter((item) => item.state === "soon").length,
        missing,
        items,
    };
}

/** Überfällig, bald und leere Felder. Dieselbe Regel wie die Schichtzähler. */
export function buildDueRows(input: DueCollectInput): DueListItem[] {
    const { items, gaps } = collectDue(input);
    return [...items, ...gaps];
}

export function dueCounts(rows: DueListItem[]): DueCounts {
    const missing: DueMissingCounts = { hu: 0, uvv: 0, licence_expiry: 0 };
    let overdue = 0;
    let soon = 0;

    for (const row of rows) {
        if (row.state === "overdue") {
            overdue += 1;
        } else if (row.state === "soon") {
            soon += 1;
        } else if (row.kind !== "licence_check") {
            missing[row.kind] += 1;
        }
    }

    return { overdue, soon, missing };
}

export const dueListQuerySchema = z.object({
    state: z.preprocess(
        emptyToUndefined,
        z
            .enum(DUE_LIST_STATES, { error: "Ungültiger Stand." })
            .optional()
            .default("overdue"),
    ),
    kind: z.preprocess(
        emptyToUndefined,
        z.enum(DUE_KINDS, { error: "Ungültige Frist." }).optional(),
    ),
    search: z.preprocess(
        firstQueryString,
        z
            .string()
            .trim()
            .max(100, "Suche darf höchstens 100 Zeichen haben.")
            .default(""),
    ),
    sort: z.preprocess(
        emptyToUndefined,
        z
            .enum(DUE_SORT_KEYS, { error: "Ungültiges Sortierfeld." })
            .optional()
            .default("due_on"),
    ),
    dir: z.preprocess(
        emptyToUndefined,
        z
            .enum(["asc", "desc"], { error: "Ungültige Sortierrichtung." })
            .optional()
            .default("asc"),
    ),
    page: z.preprocess(
        emptyToUndefined,
        z.coerce
            .number({ error: "Seite muss eine Zahl sein." })
            .int("Seite muss eine ganze Zahl sein.")
            .min(1, "Seite muss mindestens 1 sein.")
            .default(1),
    ),
    limit: z.preprocess(
        emptyToUndefined,
        z.coerce
            .number({ error: "Limit muss eine Zahl sein." })
            .int("Limit muss eine ganze Zahl sein.")
            .refine(
                (value) =>
                    (VEHICLE_PAGE_LIMITS as readonly number[]).includes(value),
                { message: "Limit muss 10, 25, 50 oder 100 sein." },
            )
            .default(10),
    ),
});

export type DueListQuery = z.infer<typeof dueListQuerySchema>;

export function parseDueListQuery(input: unknown): DueListQuery {
    return dueListQuerySchema.parse(input);
}

export function isDueListState(value: unknown): value is DueListState {
    return (
        typeof value === "string" &&
        (DUE_LIST_STATES as readonly string[]).includes(value)
    );
}

export function isDueKind(value: unknown): value is DueKind {
    return (
        typeof value === "string" &&
        (DUE_KINDS as readonly string[]).includes(value)
    );
}

export function isDueSortKey(value: unknown): value is DueSortKey {
    return (
        typeof value === "string" &&
        (DUE_SORT_KEYS as readonly string[]).includes(value)
    );
}

export function serializeDueListQuery(query: DueListQuery): URLSearchParams {
    const params = new URLSearchParams();

    params.set("state", query.state);

    if (query.kind) {
        params.set("kind", query.kind);
    }

    if (query.search) {
        params.set("search", query.search);
    }

    if (query.sort !== "due_on") {
        params.set("sort", query.sort);
    }

    if (query.dir !== "asc") {
        params.set("dir", query.dir);
    }

    if (query.page !== 1) {
        params.set("page", String(query.page));
    }

    if (query.limit !== 10) {
        params.set("limit", String(query.limit));
    }

    return params;
}

export function queryDueRows(
    rows: DueListItem[],
    query: DueListQuery,
): DueListResponse {
    const needle = query.search.toLocaleLowerCase("de");
    const searched = needle
        ? rows.filter((row) =>
              row.label.toLocaleLowerCase("de").includes(needle),
          )
        : rows;

    const counts: DueListCounts = { overdue: 0, soon: 0, missing: 0 };
    for (const row of searched) {
        counts[row.state] += 1;
    }

    const inState = searched.filter((row) => row.state === query.state);
    const kindCounts: DueKindCounts = {
        all: inState.length,
        hu: 0,
        uvv: 0,
        licence_expiry: 0,
        licence_check: 0,
    };
    for (const row of inState) {
        kindCounts[row.kind] += 1;
    }

    const filtered = query.kind
        ? inState.filter((row) => row.kind === query.kind)
        : inState;
    const sorted = [...filtered].sort((left, right) =>
        compareDueRows(left, right, query.sort, query.dir),
    );
    const total = sorted.length;
    const start = (query.page - 1) * query.limit;

    return {
        data: sorted.slice(start, start + query.limit),
        meta: {
            page: query.page,
            limit: query.limit,
            total,
            pageCount: Math.max(1, Math.ceil(total / query.limit)),
            counts,
            kind_counts: kindCounts,
        },
    };
}

function compareDueOn(left: string | null, right: string | null): number {
    if (left === right) {
        return 0;
    }

    if (left === null) {
        return -1;
    }

    if (right === null) {
        return 1;
    }

    return left < right ? -1 : 1;
}

function compareDueRows(
    left: DueListItem,
    right: DueListItem,
    sort: DueSortKey,
    dir: "asc" | "desc",
): number {
    let primary = 0;

    if (sort === "due_on") {
        primary = compareDueOn(left.due_on, right.due_on);
    } else if (sort === "label") {
        primary = left.label.localeCompare(right.label, "de");
    } else {
        primary = DUE_KIND_LABELS[left.kind].localeCompare(
            DUE_KIND_LABELS[right.kind],
            "de",
        );
    }

    if (primary !== 0) {
        return dir === "desc" ? -primary : primary;
    }

    const byDue = compareDueOn(left.due_on, right.due_on);
    if (byDue !== 0) {
        return byDue;
    }

    const byLabel = left.label.localeCompare(right.label, "de");
    if (byLabel !== 0) {
        return byLabel;
    }

    const byKind = left.kind.localeCompare(right.kind);
    if (byKind !== 0) {
        return byKind;
    }

    const byVehicle = (left.vehicle_id ?? 0) - (right.vehicle_id ?? 0);
    if (byVehicle !== 0) {
        return byVehicle;
    }

    return (left.driver_id ?? 0) - (right.driver_id ?? 0);
}

function pushCalendar(
    items: DueReminder[],
    gaps: DueListItem[],
    missing: DueMissingCounts,
    kind: "hu" | "uvv" | "licence_expiry",
    dueOn: string | null,
    today: string,
    subject: Pick<DueReminder, "vehicle_id" | "driver_id" | "label">,
) {
    const state = classifyCalendarDate(dueOn, today);

    if (state === "missing") {
        missing[kind] += 1;
        gaps.push({
            kind,
            state: "missing",
            due_on: null,
            ...subject,
        });
        return;
    }

    if (state === "overdue" || state === "soon") {
        items.push({
            kind,
            state,
            due_on: dueOn,
            ...subject,
        });
    }
}

function readIso(iso: string): { year: number; month: number; day: number } {
    const match = ISO_DATE.exec(iso);

    if (!match) {
        throw new Error(`Invalid ISO date: ${iso}`);
    }

    return {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
    };
}

function blankToNull(value: string | null): string | null {
    if (value === null || value === "") {
        return null;
    }

    return value;
}

export type DueDateSource = "month_end" | "interval" | "manual" | "stored";

export type DueExplanation = {
    last_on: string | null;
    interval_months: number | null;
    due_on: string | null;
    rule_kind: DueRuleKind;
    /** Rechtsquelle, nur wenn die Regel geprüft ist. */
    basis: string | null;
    internal_notice: string | null;
    source: DueDateSource;
    /** Letztes Prüf- oder Kontrolldatum liegt nach heute. */
    last_checked_in_future: boolean;
};

function germanDueDate(value: string | null): string {
    if (value === null || value === "") {
        return "—";
    }

    const month = /^(\d{4})-(\d{2})$/.exec(value);
    if (month) {
        return `${month[2]}.${month[1]}`;
    }

    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (day) {
        return `${day[3]}.${day[2]}.${day[1]}`;
    }

    return value;
}

/** Eine Zeile: Prüfart, Herkunft und Fälligkeit. Interne Regeln nennen den Hinweis. */
export function dueExplanationText(
    kind: DueKind,
    explanation: DueExplanation,
): string {
    if (kind === "licence_check") {
        return licenceCheckText(explanation);
    }

    const label = DUE_KIND_LABELS[kind];
    let body: string;

    if (explanation.due_on === null) {
        body = "Datum fehlt";
    } else if (explanation.source === "month_end") {
        body = `fällig am ${germanDueDate(explanation.due_on)}`;
    } else if (explanation.source === "stored") {
        body = `eingetragenes Ablaufdatum, fällig am ${germanDueDate(explanation.due_on)}`;
    } else if (explanation.source === "manual" && explanation.last_on === null) {
        body = `manuelle Fälligkeit am ${germanDueDate(explanation.due_on)}`;
    } else if (explanation.source === "manual") {
        body = `manuelle Fälligkeit am ${germanDueDate(explanation.due_on)} nach der Prüfung vom ${germanDueDate(explanation.last_on)}`;
    } else {
        body = `Prüfung vom ${germanDueDate(explanation.last_on)} plus ${explanation.interval_months} Monate, fällig am ${germanDueDate(explanation.due_on)}`;
    }

    let text = `${label}, ${body}.`;

    if (explanation.last_checked_in_future) {
        text += " Das Prüfdatum liegt nach heute.";
    }

    if (explanation.internal_notice) {
        text += ` ${explanation.internal_notice}.`;
    }

    return text;
}

function licenceCheckText(explanation: DueExplanation): string {
    if (explanation.interval_months === 0) {
        return "Führerscheinkontrolle ist ausgeschaltet.";
    }

    const notice = explanation.internal_notice
        ? ` ${explanation.internal_notice}.`
        : "";
    const months = explanation.interval_months ?? 6;

    if (explanation.due_on === null) {
        return `Bisher kein Kontrolldatum. Wiederholung alle ${months} Monate.${notice}`;
    }

    const due = germanDueDate(explanation.due_on);
    const when = explanation.last_on
        ? `Zuletzt am ${germanDueDate(explanation.last_on)}, wieder fällig am ${due}`
        : `Wieder fällig am ${due}`;
    let text = `${when}.${notice}`;

    if (explanation.last_checked_in_future) {
        text += " Das Prüfdatum liegt nach heute.";
    }

    return text;
}

export function explainHuMonth(yearMonth: string | null): DueExplanation {
    const hu = dueRule("hu");
    const result = classifyHuMonth(yearMonth, "2000-01-01", hu.lead_days);

    return {
        last_on: null,
        interval_months: null,
        due_on: result.due_on,
        rule_kind: hu.rule_kind,
        basis: hu.verified ? hu.basis : null,
        internal_notice: ruleNotice(hu.rule_kind),
        source: "month_end",
        last_checked_in_future: false,
    };
}

export function explainUvv(input: {
    checkedOn: string | null;
    manualDueOn: string | null;
    today: string;
}): DueExplanation {
    const uvv = dueRule("uvv");
    const months = uvv.interval_months ?? 12;
    const result = resolveUvvDue({
        checkedOn: input.checkedOn,
        manualDueOn: input.manualDueOn,
        intervalMonths: months,
        today: input.today,
    });

    return {
        last_on: result.last_on,
        interval_months: result.source === "manual" ? null : months,
        due_on: result.due_on,
        rule_kind: uvv.rule_kind,
        basis: uvv.verified ? uvv.basis : null,
        internal_notice: ruleNotice(uvv.rule_kind),
        source: result.source === "missing" ? "interval" : result.source,
        last_checked_in_future: result.last_checked_in_future,
    };
}

export function explainLicenceExpiry(expiresOn: string | null): DueExplanation {
    const licence = dueRule("licence_expiry");
    const dueOn = blankToNull(expiresOn);

    return {
        last_on: null,
        interval_months: null,
        due_on: dueOn,
        rule_kind: licence.rule_kind,
        basis: licence.verified ? licence.basis : null,
        internal_notice: ruleNotice(licence.rule_kind),
        source: "stored",
        last_checked_in_future: false,
    };
}

export function explainLicenceCheck(input: {
    checkedOn: string | null;
    today: string;
    intervalMonths: number;
}): DueExplanation {
    const check = dueRule("licence_check");
    const result = classifyLicenceInterval({
        checkedOn: input.checkedOn,
        today: input.today,
        intervalMonths: input.intervalMonths,
        leadDays: check.lead_days,
    });

    return {
        last_on: result.last_on,
        interval_months: input.intervalMonths,
        due_on: result.due_on,
        rule_kind: check.rule_kind,
        basis: check.verified ? check.basis : null,
        internal_notice: ruleNotice(check.rule_kind),
        source: "interval",
        last_checked_in_future: result.last_checked_in_future,
    };
}

/** Zeile der neuen Rechnung. `ok` fehlt, inaktive Subjekte fehlen. */
export type ConfiguredDueRow = {
    kind: DueKind;
    state: Exclude<DueCalendarState, "ok">;
    due_on: string | null;
    vehicle_id: number | null;
    driver_id: number | null;
    label: string;
    explanation: DueExplanation;
};

export type ConfiguredVehicleDue = {
    id: number;
    license_plate: string;
    active?: boolean;
    /** Plakettenmonat `JJJJ-MM`. */
    hu_due_on: string | null;
    uvv_checked_on: string | null;
    uvv_due_on: string | null;
};

export type ConfiguredDriverDue = {
    id: number;
    name: string;
    active?: boolean;
    licence_expires_on: string | null;
    licence_checked_on: string | null;
};

function ruleNotice(kind: DueRuleKind): string | null {
    return kind === "internal" ? INTERNAL_DUE_NOTICE : null;
}

function pushConfigured(
    rows: ConfiguredDueRow[],
    state: DueCalendarState,
    row: Omit<ConfiguredDueRow, "state">,
): void {
    if (state === "ok") {
        return;
    }

    rows.push({ ...row, state });
}

/**
 * Fristenrechnung für `GET /api/due` und die Schichtzähler.
 * `leadDays` und `licenceCheckMonths` sind die aufgelösten Firmenwerte.
 */
export function buildConfiguredDueRows(input: {
    today: string;
    leadDays: number;
    licenceCheckMonths: number;
    vehicles: ConfiguredVehicleDue[];
    drivers: ConfiguredDriverDue[];
}): ConfiguredDueRow[] {
    const rows: ConfiguredDueRow[] = [];

    for (const vehicle of input.vehicles) {
        if (!isDueActive(vehicle.active)) {
            continue;
        }

        const huResult = classifyHuMonth(
            vehicle.hu_due_on,
            input.today,
            input.leadDays,
        );
        const huExplanation = explainHuMonth(vehicle.hu_due_on);
        pushConfigured(rows, huResult.state, {
            kind: "hu",
            due_on: huResult.due_on,
            vehicle_id: vehicle.id,
            driver_id: null,
            label: vehicle.license_plate,
            explanation: huExplanation,
        });

        const uvvExplanation = explainUvv({
            checkedOn: vehicle.uvv_checked_on,
            manualDueOn: vehicle.uvv_due_on,
            today: input.today,
        });
        const uvvState =
            uvvExplanation.due_on === null
                ? "missing"
                : classifyDueOn(
                      uvvExplanation.due_on,
                      input.today,
                      input.leadDays,
                  );
        pushConfigured(rows, uvvState, {
            kind: "uvv",
            due_on: uvvExplanation.due_on,
            vehicle_id: vehicle.id,
            driver_id: null,
            label: vehicle.license_plate,
            explanation: uvvExplanation,
        });
    }

    for (const driver of input.drivers) {
        if (!isDueActive(driver.active)) {
            continue;
        }

        const expiryExplanation = explainLicenceExpiry(driver.licence_expires_on);
        const expiryState = classifyDueOn(
            expiryExplanation.due_on,
            input.today,
            input.leadDays,
        );
        pushConfigured(rows, expiryState, {
            kind: "licence_expiry",
            due_on: expiryExplanation.due_on,
            vehicle_id: null,
            driver_id: driver.id,
            label: driver.name,
            explanation: expiryExplanation,
        });

        const checkExplanation = explainLicenceCheck({
            checkedOn: driver.licence_checked_on,
            today: input.today,
            intervalMonths: input.licenceCheckMonths,
        });
        const checkResult = classifyLicenceInterval({
            checkedOn: driver.licence_checked_on,
            today: input.today,
            intervalMonths: input.licenceCheckMonths,
            leadDays: input.leadDays,
        });

        if (!checkResult.included) {
            continue;
        }

        pushConfigured(rows, checkResult.state, {
            kind: "licence_check",
            due_on: checkResult.due_on,
            vehicle_id: null,
            driver_id: driver.id,
            label: driver.name,
            explanation: checkExplanation,
        });
    }

    return rows;
}
