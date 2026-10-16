import type { AlertType } from "@fleet-live/shared";

import { ALERT_TYPE_LABELS } from "./alertLabels";
import styles from "./AlertSemantics.module.scss";

export const AlertTypeChip = ({ type }: { type: AlertType }) => (
    <span className={styles.type} data-type={type}>
        {ALERT_TYPE_LABELS[type]}
    </span>
);
