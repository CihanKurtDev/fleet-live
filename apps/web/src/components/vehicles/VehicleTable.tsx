import { useState } from "react";
import type { VehicleTableRow } from "@fleet-live/shared";

import { Table } from "../ui/Table/Table";
import type { SortConfig } from "../../types/table";
import { sortRows } from "../../utils/sortRows";
import { vehicleColumns } from "./vehicleTableConfig";

interface VehicleTableProps {
    vehicles: VehicleTableRow[];
}

export const VehicleTable = ({
    vehicles,
}: VehicleTableProps) => {
    const [sortConfig, setSortConfig] =
        useState<SortConfig<VehicleTableRow>>(null);

    const sortedVehicles = sortRows(
        vehicles,
        vehicleColumns,
        sortConfig,
    );

    const handleSort = (
        key: keyof VehicleTableRow,
    ) => {
        setSortConfig((current) => {
            // Andere Spalte oder bisher keine Sortierung:
            // → erste Sortierung aufsteigend
            if (!current || current.key !== key) {
                return {
                    key,
                    direction: "asc",
                };
            }

            // Asc → Desc
            if (current.direction === "asc") {
                return {
                    key,
                    direction: "desc",
                };
            }

            // Desc → kein Sort → ursprüngliche Reihenfolge
            return null;
        });
    };

    return (
        <Table
            columns={vehicleColumns}
            rows={sortedVehicles}
            getRowKey={(vehicle) => vehicle.id}
            sortConfig={sortConfig}
            onSort={handleSort}
        />
    );
};