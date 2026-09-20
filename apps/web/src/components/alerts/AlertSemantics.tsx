import type { AlertSeverity, AlertType } from "@fleet-live/shared";

import { ALERT_SEVERITY_LABELS, ALERT_TYPE_LABELS } from "./alertLabels";
import styles from "./AlertSemantics.module.scss";

export const AlertTypeChip = ({ type }: { type: AlertType }) => (
    <span className={styles.type} data-type={type}>
        {ALERT_TYPE_LABELS[type]}
    </span>
);

export const AlertSeverityChip = ({
    severity,
}: {
    severity: AlertSeverity;
}) => (
    <span className={styles.severity} data-severity={severity}>
        {ALERT_SEVERITY_LABELS[severity]}
    </span>
);
