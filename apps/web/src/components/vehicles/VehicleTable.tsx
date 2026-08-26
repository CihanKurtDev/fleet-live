import { useState } from "react";
import type { Vehicle } from "@fleet-live/shared";

import { Table } from "../ui/Table/Table";
import { TableToolbar } from "../ui/Table/TableToolbar";
import { TableFilterBar } from "../ui/Table/TableFilterBar";
import { TablePagination } from "../ui/Table/TablePagination";
import { useTable } from "../../hooks/useTable";
import {
    vehicleColumns,
    vehicleFilters,
    vehicleSearchKeys,
} from "./vehicleTableConfig";
import styles from "./VehicleTable.module.scss";

interface VehicleTableProps {
    vehicles: Vehicle[];
    onDeleteVehicles?: (ids: number[]) => void;
    onAddVehicle?: () => void;
    onSelectVehicle?: (vehicle: Vehicle) => void;
}

export const VehicleTable = ({
    vehicles,
    onDeleteVehicles,
    onAddVehicle,
    onSelectVehicle,
}: VehicleTableProps) => {
    const {
        tableState,
        setSearch,
        setFilter,
        handleSort,
        setPage,
        setLimit,
        filtersWithCounts,
        filteredRows,
        paginatedRows,
        pageCount,
    } = useTable({
        rows: vehicles,
        columns: vehicleColumns,
        searchKeys: vehicleSearchKeys,
        filters: vehicleFilters,
    });

    const [isEditing, setIsEditing] = useState(false);
    const [selectedIds, setSelectedIds] = useState<number[]>(
        [],
    );

    const toggleEditMode = () => {
        setIsEditing((current) => !current);
        setSelectedIds([]);
    };

    const toggleSelection = (id: number) => {
        setSelectedIds((current) =>
            current.includes(id)
                ? current.filter(
                      (selectedId) => selectedId !== id,
                  )
                : [...current, id],
        );
    };

    const deleteSelected = () => {
        onDeleteVehicles?.(selectedIds);
        setSelectedIds([]);
    };

    return (
        <section className={styles.vehicleTable}>
            <TableToolbar
                search={tableState.search}
                onSearchChange={setSearch}
                searchPlaceholder="Kennzeichen oder Fahrer suchen..."
                isEditing={isEditing}
                onToggleEditMode={toggleEditMode}
                selectedCount={selectedIds.length}
                onDeleteSelected={
                    onDeleteVehicles
                        ? deleteSelected
                        : undefined
                }
                onAddNew={onAddVehicle}
            />

            <TableFilterBar
                filters={filtersWithCounts}
                activeFilterId={tableState.filterId}
                onFilterChange={setFilter}
            />

            <Table
                columns={vehicleColumns}
                rows={paginatedRows}
                getRowKey={(vehicle) => vehicle.id}
                isEditing={isEditing}
                selectedRows={selectedIds}
                onSelectRow={(key) =>
                    toggleSelection(Number(key))
                }
                onRowClick={onSelectVehicle}
                sortConfig={tableState.sortConfig}
                onSort={handleSort}
            />

            {filteredRows.length > 0 && (
                <TablePagination
                    page={tableState.page}
                    pageCount={pageCount}
                    limit={tableState.limit}
                    total={filteredRows.length}
                    onPageChange={setPage}
                    onLimitChange={setLimit}
                />
            )}
        </section>
    );
};
