import { useState } from "react";
import type { Vehicle } from "@fleet-live/shared";

import { Table } from "../ui/Table/Table";
import { TableToolbar } from "../ui/Table/TableToolbar";
import { TableFilterBar } from "../ui/Table/TableFilterBar";
import { TablePagination } from "../ui/Table/TablePagination";
import { useTable } from "../../hooks/useTable";
import { useVehicleList } from "../../hooks/useVehicleList";
import { useVehicleListQuery } from "../../hooks/useVehicleListQuery";
import {
    vehicleColumns,
    vehicleFilters,
} from "./vehicleTableConfig";
import styles from "./VehicleTable.module.scss";

interface VehicleTableProps {
    onDeleteVehicles?: (ids: number[]) => void;
    onAddVehicle?: () => void;
    onSelectVehicle?: (vehicle: Vehicle) => void;
}

export const VehicleTable = ({
    onDeleteVehicles,
    onAddVehicle,
    onSelectVehicle,
}: VehicleTableProps) => {
    const {
        apiQuery,
        tableState,
        setSearch,
        setFilter,
        handleSort,
        setPage,
        setLimit,
    } = useVehicleListQuery();

    const { data, meta, isLoading, isFetching, error, pageCount, total } =
        useVehicleList(apiQuery);

    const {
        filtersWithCounts,
        paginatedRows,
    } = useTable({
        rows: data,
        filters: vehicleFilters,
        counts: meta?.counts,
        pageCount,
        total,
        tableState,
        setSearch,
        setFilter,
        handleSort,
        setPage,
        setLimit,
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
        <section
            className={
                isFetching && !isLoading
                    ? `${styles.vehicleTable} ${styles.isFetching}`
                    : styles.vehicleTable
            }
        >
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

            {!isLoading && (
                <TableFilterBar
                    filters={filtersWithCounts}
                    activeFilterId={tableState.filterId}
                    onFilterChange={setFilter}
                />
            )}

            {error && (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            )}

            {isLoading && (
                <p className={styles.status} aria-live="polite">
                    Tabelle wird geladen…
                </p>
            )}

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
                isLoading={isLoading}
                skeletonRowCount={Math.min(tableState.limit, 10)}
            />

            {total > 0 && (
                <TablePagination
                    page={tableState.page}
                    pageCount={pageCount}
                    limit={tableState.limit}
                    total={total}
                    onPageChange={setPage}
                    onLimitChange={setLimit}
                />
            )}
        </section>
    );
};
