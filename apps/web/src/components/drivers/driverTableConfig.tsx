import {
    DRIVER_TALK_MIN_OPEN_WARNINGS,
    type Driver,
    type DriverListCounts,
} from "@fleet-live/shared";
import type { TableColumn } from "../../types/table";
import type { KpiTileTone } from "../ui/KpiTiles/KpiTiles";
import type { DriverTileId } from "../../hooks/useDriverListQuery";
import { DriverVehicleCell, DriverWarningCell } from "./DriverTableCells";
import styles from "./DriverTableCells.module.scss";

type DriverTileOption = {
    id: DriverTileId;
    label: string;
    count: keyof DriverListCounts;
    hint?: string;
    tone?: KpiTileTone;
};

/** KPI tiles on `/drivers`: the main filter, exactly one is pressed. */
export const driverTileOptions: DriverTileOption[] = [
    { id: "all", label: "Alle", count: "all" },
    {
        id: "talk",
        label: "Gespräch führen",
        count: "talk",
        hint: `ab ${DRIVER_TALK_MIN_OPEN_WARNINGS} offenen Tempo-Warnungen`,
        tone: "critical",
    },
    {
        id: "without_vehicle",
        label: "Ohne Fahrzeug",
        count: "without_vehicle",
        hint: "kein aktuelles Fahrzeug",
    },
];

export const driverColumns: TableColumn<Driver>[] = [
    {
        key: "name",
        displayText: "Fahrer",
        width: "240px",
        sortable: true,
        // Plain bold text: the row opens the driver.
        render: (value) => (
            <span className={styles.strong} title={value}>
                {value}
            </span>
        ),
    },
    {
        key: "phone",
        displayText: "Telefon",
        width: "170px",
        sortable: false,
        render: (value) =>
            value ? (
                <span title={value}>{value}</span>
            ) : (
                <span className={styles.muted}>—</span>
            ),
    },
    {
        key: "vehicle_count",
        displayText: "Fahrzeug",
        width: "200px",
        sortable: true,
        render: (_value, { row }) => <DriverVehicleCell driver={row} />,
    },
    {
        key: "counts",
        displayText: "Verstöße",
        width: "140px",
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
