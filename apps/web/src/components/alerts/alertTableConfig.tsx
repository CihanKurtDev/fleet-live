import { formatAlertEvent, type Alert, type AlertFilterId } from "@fleet-live/shared";
import type { TableColumn, TableFilter } from "../../types/table";
import { formatTimestamp } from "../../utils/dateTime";
import { DriverNameLink } from "../drivers/DriverNameLink";

export const alertFilters: Array<
    TableFilter<Alert> & { id: Exclude<AlertFilterId, "all"> }
> = [
    { id: "open", displayText: "Offen" },
    { id: "resolved", displayText: "Erledigt" },
];

export const alertColumns: TableColumn<Alert>[] = [
    {
        key: "message",
        displayText: "Ereignis",
        render: (_value, { row }) => formatAlertEvent(row),
    },
    {
        key: "driver_name",
        displayText: "Fahrer",
        render: (value, { row }) => (
            <DriverNameLink driverId={row.driver_id} name={value} />
        ),
    },
    {
        key: "license_plate",
        displayText: "Fahrzeug",
    },
    {
        key: "created_at",
        displayText: "Zeitpunkt",
        sortable: true,
        render: (value) => formatTimestamp(value),
    },
];
