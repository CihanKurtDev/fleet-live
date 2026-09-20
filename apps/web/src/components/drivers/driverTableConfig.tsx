import type { Driver } from "@fleet-live/shared";
import type { TableColumn } from "../../types/table";
import {
    DriverNameCell,
    DriverVehicleCell,
    DriverWarningCell,
} from "./DriverTableCells";

export const driverColumns: TableColumn<Driver>[] = [
    {
        key: "name",
        displayText: "Fahrer",
        sortable: true,
        render: (_value, { row }) => <DriverNameCell driver={row} />,
    },
    {
        key: "phone",
        displayText: "Telefon",
        sortable: false,
        render: (value) => value ?? "—",
    },
    {
        key: "vehicle_count",
        displayText: "Fahrzeug(e)",
        sortable: true,
        render: (_value, { row }) => <DriverVehicleCell driver={row} />,
    },
    {
        key: "counts",
        displayText: "Verstöße",
        sortable: true,
        render: (value) => `${value.all} gesamt`,
    },
    {
        key: "open_warnings",
        displayText: "Davon offen",
        sortable: true,
        render: (_value, { row }) => <DriverWarningCell driver={row} />,
    },
];
