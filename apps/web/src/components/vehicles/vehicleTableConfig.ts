import type { Vehicle, VehicleFilterId } from "@fleet-live/shared";
import type {
    TableColumn,
    TableFilter,
} from "../../types/table";
import { vehicleStatusLabel } from "./vehicleStatus";

export const vehicleFilters: Array<
    TableFilter<Vehicle> & { id: VehicleFilterId }
> = [
    { id: "alerts", displayText: "Warnungen" },
    { id: "low_fuel", displayText: "Wenig Tank" },
    { id: "driving", displayText: "Auf Fahrt" },
    { id: "offline", displayText: "Kein Signal" },
];

export const vehicleColumns: TableColumn<Vehicle>[] = [
    {
        key: "license_plate",
        displayText: "Kennzeichen",
        sortable: true,
    },
    {
        key: "driver_name",
        displayText: "Fahrer",
        sortable: true,
    },
    {
        key: "status",
        displayText: "Status",
        sortable: true,
        render: (value) => vehicleStatusLabel(value),
    },
    {
        key: "fuel_level",
        displayText: "Tankstand",
        sortable: true,
        render: (value) => `${Math.round(value)}%`,
    },
    {
        key: "speed",
        displayText: "Geschwindigkeit",
        sortable: true,
        render: (value) =>
            value === null
                ? "—"
                : `${value} km/h`,
    },
    {
        key: "active_alerts",
        displayText: "Warnungen",
        sortable: true,
        render: (value) =>
            value > 0
                ? `${value}`
                : "—",
    },
];
