import type { TripListItem } from "@fleet-live/shared";
import { WarningChip } from "../alerts/WarningChip";
import type { TableColumn } from "../../types/table";
import { formatTimestamp } from "../../utils/dateTime";
import styles from "./tripTableConfig.module.scss";

const formatKilometers = (meters: number) =>
    `${(meters / 1_000).toLocaleString("de-DE", {
        maximumFractionDigits: 1,
    })} km`;

export const tripColumns: TableColumn<TripListItem>[] = [
    {
        key: "started_at",
        displayText: "Start",
        render: (value) => formatTimestamp(value),
    },
    {
        key: "ended_at",
        displayText: "Ende",
        render: (value) => (value ? formatTimestamp(value) : "läuft"),
    },
    {
        key: "driver_name",
        displayText: "Fahrer",
        render: (value) =>
            value ?? <span className={styles.muted}>nicht erfasst</span>,
    },
    {
        key: "distance_m",
        displayText: "Strecke",
        render: (value) => formatKilometers(value),
    },
    {
        key: "max_speed",
        displayText: "Spitze",
        // Red when the trip was over the limit somewhere.
        render: (value, { row }) => (
            <span
                className={row.speeding_count > 0 ? styles.over : undefined}
            >
                {Math.round(value)} km/h
            </span>
        ),
    },
    {
        key: "speeding_count",
        displayText: "Verstöße",
        render: (value, { row }) =>
            value === 0 && row.offline_count === 0 ? (
                <span className={styles.muted}>keine</span>
            ) : (
                <span className={styles.chips}>
                    {value > 0 && <WarningChip type="SPEEDING" count={value} />}
                    {row.offline_count > 0 && (
                        <WarningChip type="OFFLINE" count={row.offline_count} />
                    )}
                </span>
            ),
    },
];
