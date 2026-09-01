import {
    formatAlertEvent,
    type Alert,
    type AlertFilterId,
    type AlertType,
} from "@fleet-live/shared";
import type { TableColumn, TableFilter } from "../../types/table";
import { formatTimestamp } from "../../utils/dateTime";
import { DriverNameLink } from "../drivers/DriverNameLink";
import { ALERT_SEVERITY_LABELS, ALERT_TYPE_LABELS } from "./alertLabels";

export const alertFilters: Array<
    TableFilter<Alert> & { id: Exclude<AlertFilterId, "all"> }
> = [
    { id: "open", displayText: "Offen" },
    { id: "resolved", displayText: "Erledigt" },
];

export const alertTypeFilters: Array<TableFilter<Alert> & { id: AlertType }> = [
    { id: "SPEEDING", displayText: ALERT_TYPE_LABELS.SPEEDING },
    { id: "LOW_FUEL", displayText: ALERT_TYPE_LABELS.LOW_FUEL },
    { id: "OFFLINE", displayText: ALERT_TYPE_LABELS.OFFLINE },
];

export const alertColumns: TableColumn<Alert>[] = [
    {
        key: "message",
        displayText: "Ereignis",
        render: (_value, { row }) => formatAlertEvent(row),
    },
    {
        key: "type",
        displayText: "Art",
        sortable: true,
        render: (value) => ALERT_TYPE_LABELS[value],
    },
    {
        key: "severity",
        displayText: "Schwere",
        sortable: true,
        render: (value) => ALERT_SEVERITY_LABELS[value],
    },
    {
        key: "driver_name",
        displayText: "Fahrer",
        sortable: true,
        render: (value, { row }) => (
            <DriverNameLink driverId={row.driver_id} name={value} />
        ),
    },
    {
        key: "license_plate",
        displayText: "Fahrzeug",
        sortable: true,
    },
    {
        key: "created_at",
        displayText: "Zeitpunkt",
        sortable: true,
        render: (value) => formatTimestamp(value),
    },
];
