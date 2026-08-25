import type { VehicleTableRow } from "@fleet-live/shared";
import type { TableColumn } from "../../types/table";

export const vehicleColumns: TableColumn<VehicleTableRow>[] = [
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
        key: "activeAlerts",
        displayText: "Warnungen",
        sortable: true,
        render: (value) =>
            value > 0
                ? `${value}`
                : "-",
    },
];