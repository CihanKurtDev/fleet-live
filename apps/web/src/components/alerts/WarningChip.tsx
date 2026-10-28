import type { AlertType } from "@fleet-live/shared";
import { ALERT_TYPE_CHIPS } from "./alertLabels";
import styles from "./WarningChip.module.scss";

/** `count` above one is written in front („2× Tempo“). */
export const WarningChip = ({
    type,
    count = 1,
}: {
    type: AlertType;
    count?: number;
}) => (
    <span className={styles.chip} data-type={type}>
        {count > 1 ? `${count}× ` : ""}
        {ALERT_TYPE_CHIPS[type]}
    </span>
);
