import type { AlertType } from "@fleet-live/shared";
import { ALERT_TYPE_CHIPS } from "./alertLabels";
import styles from "./WarningChip.module.scss";

export const WarningChip = ({ type }: { type: AlertType }) => (
    <span className={styles.chip} data-type={type}>
        {ALERT_TYPE_CHIPS[type]}
    </span>
);
