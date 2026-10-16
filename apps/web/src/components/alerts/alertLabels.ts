import type { Alert, AlertType } from "@fleet-live/shared";

export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
    SPEEDING: "Tempo",
    LOW_FUEL: "Wenig Tank",
    OFFLINE: "Funk",
};

export const ALERT_TYPE_CHIPS: Record<AlertType, string> = {
    SPEEDING: "Tempo",
    LOW_FUEL: "Tank",
    OFFLINE: "Funk",
};

export const alertTypeLabel = (type: AlertType) => ALERT_TYPE_LABELS[type];

export const warningCount = (count: number) =>
    count === 1 ? "1 Warnung" : `${count} Warnungen`;

/** Rückmeldung nach dem Erledigen. */
export const resolvedNotice = (count: number) =>
    count === 1 ? "Warnung erledigt." : `${count} Warnungen erledigt.`;

/** „alle Funk · 3 Fahrzeuge“ oder „Tempo, Funk · 2 Fahrzeuge“. */
export const selectionSummary = (
    rows: Array<Pick<Alert, "type" | "vehicle_id">>,
): string => {
    const types = [...new Set(rows.map((row) => row.type))];
    const vehicles = new Set(rows.map((row) => row.vehicle_id)).size;
    const typeText =
        types.length === 1
            ? `${rows.length > 1 ? "alle " : ""}${ALERT_TYPE_LABELS[types[0]]}`
            : types.map((type) => ALERT_TYPE_LABELS[type]).join(", ");

    return `${typeText} · ${vehicles === 1 ? "1 Fahrzeug" : `${vehicles} Fahrzeuge`}`;
};
