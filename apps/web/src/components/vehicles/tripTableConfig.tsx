import type { TripListItem } from "@fleet-live/shared";
import type { TableColumn } from "../../types/table";
import { formatTimestamp } from "../../utils/dateTime";

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
        key: "distance_m",
        displayText: "Strecke",
        render: (value) => formatKilometers(value),
    },
    {
        key: "max_speed",
        displayText: "Spitze",
        render: (value) => `${Math.round(value)} km/h`,
    },
];
