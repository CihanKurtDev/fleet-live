import type { Driver } from "@fleet-live/shared";
import type { TableColumn } from "../../types/table";
import { DriverNameLink } from "./DriverNameLink";

function vehicleLabel(driver: Driver): string {
    if (driver.vehicle_count === 0) {
        return "—";
    }

    if (driver.vehicle_count === 1) {
        return driver.vehicle_plate ?? "1 Fahrzeug";
    }

    return `${driver.vehicle_count} Fahrzeuge`;
}

export const driverColumns: TableColumn<Driver>[] = [
    {
        key: "name",
        displayText: "Fahrer",
        render: (value, { row }) => (
            <DriverNameLink driverId={row.id} name={value} />
        ),
    },
    {
        key: "vehicle_count",
        displayText: "Fahrzeug(e)",
        render: (_value, { row }) => vehicleLabel(row),
    },
    {
        key: "counts",
        displayText: "Verstöße",
        render: (value) => value.all,
    },
    {
        key: "open_warnings",
        displayText: "Davon offen",
        render: (value) => value,
    },
];
