import type { AlertType } from "@fleet-live/shared";

import { formatCount } from "../../utils/formatCount";

export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
    SPEEDING: "Tempo",
    LOW_FUEL: "Wenig Tank",
    OFFLINE: "Kein Signal",
};

export const ALERT_TYPE_CHIPS: Record<AlertType, string> = {
    SPEEDING: "Tempo",
    LOW_FUEL: "Tank",
    OFFLINE: "Kein Signal",
};

export const alertTypeLabel = (type: AlertType) => ALERT_TYPE_LABELS[type];

export const warningCount = (count: number) =>
    count === 1 ? "1 Warnung" : `${formatCount(count)} Warnungen`;

/** Rückmeldung nach dem Erledigen. */
export const resolvedNotice = (count: number) =>
    count === 1 ? "Warnung erledigt." : `${formatCount(count)} Warnungen erledigt.`;

