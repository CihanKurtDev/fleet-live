import { z } from "zod";
import { emptyToUndefined } from "./queryPreprocess";
import { LIST_PAGE_LIMIT_MAX, VEHICLE_PAGE_LIMITS } from "./vehicleQuery";

export const ALERT_TYPES = ["SPEEDING", "LOW_FUEL", "OFFLINE"] as const;
export const ALERT_SEVERITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export const ALERT_FILTERS = ["open", "resolved", "all"] as const;
export const ALERT_SORT_KEYS = [
    "created_at",
    "type",
    "severity",
    "driver_name",
    "license_plate",
] as const;

export type AlertType = (typeof ALERT_TYPES)[number];
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];
export type AlertFilterId = (typeof ALERT_FILTERS)[number];
export type AlertSortKey = (typeof ALERT_SORT_KEYS)[number];
export type AlertPageLimit = (typeof VEHICLE_PAGE_LIMITS)[number];

/** SPEEDING-Ereignis: Limit, Spitze, Dauer. Andere Typen haben ein anderes Shape. */
export type SpeedingAlertDetails = {
    limit_kmh: number;
    max_speed_kmh: number;
    /** Zeit über dem Limit, alle Überschreitungen der Fahrt zusammen. */
    duration_s: number;
    /** Wie oft das Fahrzeug auf dieser Fahrt über das Limit kam. Fehlt = einmal. */
    event_count?: number;
    /** Stand der früheren Überschreitungen dieser Fahrt (Server). */
    carried_duration_s?: number;
    carried_max_kmh?: number;
};

export type LowFuelAlertDetails = {
    fuel_level: number;
};

export type AlertDetails =
    | SpeedingAlertDetails
    | LowFuelAlertDetails
    | Record<string, unknown>;

/** Unter diesem Tankstand gilt ein Fahrzeug als wenig Tank (Anzeige, kein Live-Ticker). */
export const LOW_FUEL_THRESHOLD_PERCENT = 15;

/** Darunter wird der Hinweis als kritisch markiert. */
export const LOW_FUEL_CRITICAL_PERCENT = 5;

/**
 * Kein Telemetrie-Tick, obwohl die Firma pausiert ist und das Fahrzeug
 * zuletzt simuliert wurde. Unfokussierte Fahrzeuge zählen nicht — die
 * Simulation schreibt die nur bei Focus.
 */
export const OFFLINE_AFTER_MS = 15_000;

/**
 * Warnungen, die einen Zustand melden und sich selbst schließen, sobald der
 * Zustand vorbei ist (Tank wieder über der Schwelle, Signal wieder da). Man
 * erledigt sie nicht von Hand.
 */
export const SELF_CLOSING_ALERT_TYPES = ["LOW_FUEL", "OFFLINE"] as const;

export function isSelfClosingAlertType(type: string): boolean {
    return (SELF_CLOSING_ALERT_TYPES as readonly string[]).includes(type);
}

/**
 * Ein beendetes Tempo-Ereignis, das so lange niemand erledigt hat, gilt danach
 * als Verlauf und steht nicht mehr bei den offenen Warnungen.
 */
export const SPEEDING_OPEN_DAYS = 7;

/** Erledigte Warnungen werden so viele Tage nach dem Erledigen gelöscht; die Monatssummen bleiben. */
export const ALERT_RETENTION_DAYS = 90;

/**
 * Eine Warnung hängt am Fahrzeug. `driver_id` ist der Fahrer zum
 * Zeitpunkt des Open (Snapshot). `license_plate` kommt aus dem Join
 * aufs Fahrzeug, `driver_name` aus dem Snapshot-Fahrer.
 *
 * `ended_at` ist das Ende der Überschreitung, `resolved_at` die Erledigung
 * durch den Dispatcher — beides unabhängig.
 */
export type Alert = {
    id: number;
    vehicle_id: number;
    driver_id: number | null;
    license_plate: string;
    driver_name: string | null;
    type: AlertType;
    severity: AlertSeverity;
    message: string;
    details: AlertDetails | null;
    created_at: string;
    ended_at: string | null;
    resolved_at: string | null;
};

export function isSpeedingAlertDetails(
    value: unknown,
): value is SpeedingAlertDetails {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const record = value as Record<string, unknown>;

    return (
        typeof record.limit_kmh === "number" &&
        typeof record.max_speed_kmh === "number" &&
        typeof record.duration_s === "number"
    );
}

export function isLowFuelAlertDetails(
    value: unknown,
): value is LowFuelAlertDetails {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    return typeof (value as Record<string, unknown>).fuel_level === "number";
}

export function isLowFuelLevel(fuelLevel: number): boolean {
    return fuelLevel < LOW_FUEL_THRESHOLD_PERCENT;
}

export function lowFuelSeverity(
    fuelLevel: number,
): Extract<AlertSeverity, "MEDIUM" | "HIGH"> {
    return fuelLevel < LOW_FUEL_CRITICAL_PERCENT ? "HIGH" : "MEDIUM";
}

export function formatAlertDuration(durationSeconds: number): string {
    const seconds = Math.max(0, Math.round(durationSeconds));

    if (seconds < 60) {
        return `${seconds} s`;
    }

    if (seconds < 3_600) {
        return `${Math.round(seconds / 60)} Min.`;
    }

    if (seconds < 86_400) {
        return `${Math.round(seconds / 3_600)} Std.`;
    }

    const days = Math.round(seconds / 86_400);
    return `${days} ${days === 1 ? "Tag" : "Tage"}`;
}

/**
 * Ereigniszeile für die Inbox: aus `type` + `details`, sonst `message`.
 */
export function formatAlertEvent(
    alert: Pick<Alert, "type" | "message" | "details">,
): string {
    if (alert.type === "SPEEDING" && isSpeedingAlertDetails(alert.details)) {
        const times =
            (alert.details.event_count ?? 1) > 1
                ? ` · ${alert.details.event_count}-mal`
                : "";

        return `${Math.round(alert.details.max_speed_kmh)} km/h bei Limit ${Math.round(alert.details.limit_kmh)} · ${formatAlertDuration(alert.details.duration_s)}${times}`;
    }

    if (alert.type === "LOW_FUEL" && isLowFuelAlertDetails(alert.details)) {
        return `Tankstand ${Math.round(alert.details.fuel_level)} %`;
    }

    return alert.message;
}

export type AlertListCounts = {
    all: number;
    open: number;
    resolved: number;
};

/** Typ-Facets: gelten für den aktuellen Statusfilter (`open`/`resolved`/`all`). */
export type AlertTypeCounts = {
    all: number;
    SPEEDING: number;
    LOW_FUEL: number;
    OFFLINE: number;
};

export type AlertListMeta = {
    page: number;
    limit: number;
    total: number;
    pageCount: number;
    counts: AlertListCounts;
    type_counts: AlertTypeCounts;
};

export type AlertListResponse = {
    data: Alert[];
    meta: AlertListMeta;
};

export type AlertPatch = {
    resolved: true;
};

/** Höchstens so viele Warnungen schließt ein Sammel-Erledigen auf einmal. */
export const ALERT_BULK_MAX_IDS = 100;

export type AlertBulkPatch = {
    ids: number[];
    resolved: true;
};

/** `resolved`: Zeilen, die dieser Aufruf von offen auf erledigt gesetzt hat. */
export type AlertBulkPatchResponse = {
    data: { resolved: number };
};

export const alertListQuerySchema = z.object({
    filter: z.preprocess(
        emptyToUndefined,
        z
            .enum(ALERT_FILTERS, { error: "Ungültiger Filter." })
            .optional()
            .default("open"),
    ),
    sort: z.preprocess(
        emptyToUndefined,
        z
            .enum(ALERT_SORT_KEYS, { error: "Ungültiges Sortierfeld." })
            .optional()
            .default("created_at"),
    ),
    dir: z.preprocess(
        emptyToUndefined,
        z
            .enum(["asc", "desc"], { error: "Ungültige Sortierrichtung." })
            .optional()
            .default("desc"),
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
            .min(1, `Limit muss zwischen 1 und ${LIST_PAGE_LIMIT_MAX} liegen.`)
            .max(
                LIST_PAGE_LIMIT_MAX,
                `Limit muss zwischen 1 und ${LIST_PAGE_LIMIT_MAX} liegen.`,
            )
            .default(10),
    ),
    vehicle_id: z.preprocess(
        emptyToUndefined,
        z.coerce
            .number({ error: "Fahrzeug-ID muss eine Zahl sein." })
            .int("Fahrzeug-ID muss eine ganze Zahl sein.")
            .min(1, "Fahrzeug-ID muss mindestens 1 sein.")
            .optional(),
    ),
    driver_id: z.preprocess(
        emptyToUndefined,
        z.coerce
            .number({ error: "Fahrer-ID muss eine Zahl sein." })
            .int("Fahrer-ID muss eine ganze Zahl sein.")
            .min(1, "Fahrer-ID muss mindestens 1 sein.")
            .optional(),
    ),
    type: z.preprocess(
        emptyToUndefined,
        z
            .enum(ALERT_TYPES, { error: "Ungültiger Warnungstyp." })
            .optional(),
    ),
});

export type AlertListQuery = z.infer<typeof alertListQuerySchema>;

export const alertPatchSchema = z.object({
    resolved: z.literal(true, { error: "resolved muss true sein." }),
});

export const alertBulkPatchSchema = z.object({
    ids: z
        .array(
            z
                .number({ error: "Warnungs-IDs müssen Zahlen sein." })
                .int("Warnungs-IDs müssen ganze Zahlen sein.")
                .positive("Warnungs-IDs müssen größer als 0 sein."),
            { error: "ids muss eine Liste von Warnungs-IDs sein." },
        )
        .min(1, "Keine Warnung ausgewählt.")
        .max(
            ALERT_BULK_MAX_IDS,
            `Höchstens ${ALERT_BULK_MAX_IDS} Warnungen auf einmal.`,
        )
        .refine((ids) => new Set(ids).size === ids.length, {
            error: "Jede Warnung darf nur einmal vorkommen.",
        }),
    resolved: z.literal(true, { error: "resolved muss true sein." }),
});

export function parseAlertListQuery(input: unknown): AlertListQuery {
    return alertListQuerySchema.parse(input);
}

export function parseAlertPatch(input: unknown): AlertPatch {
    return alertPatchSchema.parse(input);
}

export function parseAlertBulkPatch(input: unknown): AlertBulkPatch {
    return alertBulkPatchSchema.parse(input);
}

export function serializeAlertListQuery(
    query: AlertListQuery,
): URLSearchParams {
    const params = new URLSearchParams();

    if (query.filter !== "open") {
        params.set("filter", query.filter);
    }

    if (query.sort !== "created_at") {
        params.set("sort", query.sort);
    }

    if (query.dir !== "desc") {
        params.set("dir", query.dir);
    }

    if (query.page !== 1) {
        params.set("page", String(query.page));
    }

    if (query.limit !== 10) {
        params.set("limit", String(query.limit));
    }

    if (query.vehicle_id !== undefined) {
        params.set("vehicle_id", String(query.vehicle_id));
    }

    if (query.driver_id !== undefined) {
        params.set("driver_id", String(query.driver_id));
    }

    if (query.type !== undefined) {
        params.set("type", query.type);
    }

    return params;
}

export function isAlertType(value: unknown): value is AlertType {
    return (
        typeof value === "string" &&
        (ALERT_TYPES as readonly string[]).includes(value)
    );
}

export function isAlertSeverity(value: unknown): value is AlertSeverity {
    return (
        typeof value === "string" &&
        (ALERT_SEVERITIES as readonly string[]).includes(value)
    );
}

export function isAlertFilterId(value: unknown): value is AlertFilterId {
    return (
        typeof value === "string" &&
        (ALERT_FILTERS as readonly string[]).includes(value)
    );
}

export function isAlertSortKey(value: unknown): value is AlertSortKey {
    return (
        typeof value === "string" &&
        (ALERT_SORT_KEYS as readonly string[]).includes(value)
    );
}
