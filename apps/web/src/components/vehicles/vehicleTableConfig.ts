import type { Vehicle } from "@fleet-live/shared";
import type {
    TableColumn,
    TableFilter,
} from "../../types/table";

/** Ab diesem Tankstand gilt ein Fahrzeug als kritisch. */
const LOW_FUEL_THRESHOLD = 20;

export const vehicleSearchKeys: Array<keyof Vehicle> = [
    "license_plate",
    "driver_name",
];

export const vehicleFilters: TableFilter<Vehicle>[] = [
    {
        id: "alerts",
        displayText: "Warnungen",
        customSearchFunc: (vehicle) =>
            vehicle.active_alerts > 0,
    },
    {
        id: "low_fuel",
        displayText: "Wenig Tank",
        customSearchFunc: (vehicle) =>
            vehicle.fuel_level < LOW_FUEL_THRESHOLD,
    },
    {
        id: "driving",
        displayText: "Unterwegs",
        customSearchFunc: (vehicle) =>
            vehicle.status === "DRIVING",
    },
    {
        id: "offline",
        displayText: "Offline",
        customSearchFunc: (vehicle) =>
            vehicle.status === "OFFLINE",
    },
];

export const vehicleColumns: TableColumn<Vehicle>[] = [
    /*
     * Jede Spalte kann optional ein eigenes `sortBy` definieren.
     *
     * Ohne `sortBy` wird automatisch der Wert von `key` zum Sortieren verwendet.
     * Mit `sortBy` kann eine eigene Sortierlogik definiert werden, z. B.:
     *
     * sortBy: (vehicle) => {
     *     // Wert zurückgeben, nach dem tatsächlich sortiert werden soll
     *     return vehicle.status;
     * },
     *
     * Das ist besonders nützlich, wenn die fachliche Sortierreihenfolge
     * nicht der normalen alphabetischen/numerischen Reihenfolge entspricht.
     */

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

        // Beispiel für eine eigene fachliche Sortierreihenfolge:
        //
        // sortBy: (vehicle) => {
        //     const order = {
        //         OFFLINE: 0,
        //         DRIVING: 1,
        //         STOPPED: 2,
        //         IDLE: 3,
        //     };
        //
        //     return order[vehicle.status];
        // },
    },
    {
        key: "fuel_level",
        displayText: "Tank",
        sortable: true,
        render: (value) => `${value}%`,
    },
    {
        key: "speed",
        displayText: "Geschwindigkeit",
        sortable: true,
        render: (value) =>
            value === null
                ? "-"
                : `${value} km/h`,
    },
    {
        key: "active_alerts",
        displayText: "Warnungen",
        sortable: true,
        render: (value) =>
            value > 0
                ? `${value}`
                : "-",
    },
];