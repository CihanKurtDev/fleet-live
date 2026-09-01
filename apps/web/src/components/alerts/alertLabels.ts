import type { AlertSeverity, AlertType } from "@fleet-live/shared";

export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
    SPEEDING: "Geschwindigkeit",
    LOW_FUEL: "Wenig Tank",
    OFFLINE: "Kein Signal",
};

export const ALERT_TYPE_CHIPS: Record<AlertType, string> = {
    SPEEDING: "Tempo",
    LOW_FUEL: "Tank",
    OFFLINE: "Funk",
};

export const ALERT_SEVERITY_LABELS: Record<AlertSeverity, string> = {
    LOW: "Niedrig",
    MEDIUM: "Mittel",
    HIGH: "Hoch",
};

export const alertTypeLabel = (type: AlertType) => ALERT_TYPE_LABELS[type];

export const alertSeverityLabel = (severity: AlertSeverity) =>
    ALERT_SEVERITY_LABELS[severity];
