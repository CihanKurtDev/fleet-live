import { useState } from "react";
import type { Vehicle } from "@fleet-live/shared";

import { Table } from "../ui/Table/Table";
import { TableToolbar } from "../ui/Table/TableToolbar";
import { TableFilterBar } from "../ui/Table/TableFilterBar";
import { TablePagination } from "../ui/Table/TablePagination";
import { ConfirmDialog } from "../ui/Modal/ConfirmDialog";
import { useServerTable } from "../../hooks/useServerTable";
import { useVehicleList } from "../../hooks/useVehicleList";
import { useVehicleListQuery } from "../../hooks/useVehicleListQuery";
import { vehicleColumns, vehicleFilters } from "./vehicleTableConfig";
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
    const listQuery = useVehicleListQuery();
    const listResult = useVehicleList(listQuery.apiQuery);
    const {
        tableState,
        filtersWithCounts,
        paginatedRows,
        isLoading,
        error,
        pageCount,
        total,
        showPagination,
        sectionClassName,
        emptyContent,
        setSearch,
        setFilter,
        handleSort,
        setPage,
        setLimit,
    } = useServerTable<Vehicle>({
        listQuery,
        listResult,
        filters: vehicleFilters,
        counts: listResult.meta?.counts,
    });

    const [isEditing, setIsEditing] = useState(false);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [pendingDeleteIds, setPendingDeleteIds] = useState<number[] | null>(
        null,
    );

    const toggleEditMode = () => {
        setIsEditing((current) => !current);
        setSelectedIds([]);
    };

    const toggleSelection = (id: number) => {
        setSelectedIds((current) =>
            current.includes(id)
                ? current.filter((selectedId) => selectedId !== id)
                : [...current, id],
        );
    };

    const pendingCount = pendingDeleteIds?.length ?? 0;
    const pendingVehicle =
        pendingCount === 1
            ? listResult.data.find(
                  (vehicle) => vehicle.id === pendingDeleteIds?.[0],
              )
            : undefined;

    const confirmDelete = () => {
        if (!pendingDeleteIds) {
            return;
        }

        onDeleteVehicles?.(pendingDeleteIds);
        setSelectedIds([]);
        setPendingDeleteIds(null);
    };

    return (
        <section
            className={sectionClassName(styles.vehicleTable, styles.isFetching)}
        >
            <h1 className={styles.title}>Fahrzeuge</h1>

            <TableToolbar
                search={tableState.search}
                onSearchChange={setSearch}
                searchPlaceholder="Kennzeichen oder Fahrer suchen..."
                searchAriaLabel="Kennzeichen oder Fahrer suchen"
                addNewLabel="Fahrzeug anlegen"
                isEditing={isEditing}
                onToggleEditMode={
                    onDeleteVehicles ? toggleEditMode : undefined
                }
                selectedCount={selectedIds.length}
                onDeleteSelected={
                    onDeleteVehicles
                        ? () => setPendingDeleteIds(selectedIds)
                        : undefined
                }
                onAddNew={onAddVehicle}
            />

            {!isLoading && (
                <TableFilterBar
                    filters={filtersWithCounts}
                    activeFilterId={tableState.filterId}
                    onFilterChange={setFilter}
                    allCount={listResult.meta?.counts.all}
                    groupLabel="Status"
                    ariaLabel="Status"
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
                onSelectRow={(key) => toggleSelection(Number(key))}
                onRowClick={onSelectVehicle}
                sortConfig={tableState.sortConfig}
                onSort={handleSort}
                caption="Fahrzeugliste"
                isLoading={isLoading}
                skeletonRowCount={Math.min(tableState.limit, 10)}
                emptyContent={emptyContent(
                    tableState.search || tableState.filterId
                        ? "Keine Fahrzeuge passen zu Suche und Filter."
                        : "Keine Fahrzeuge vorhanden.",
                )}
            />

            {showPagination && (
                <TablePagination
                    page={tableState.page}
                    pageCount={pageCount}
                    limit={tableState.limit}
                    total={total}
                    onPageChange={setPage}
                    onLimitChange={setLimit}
                />
            )}

            <ConfirmDialog
                open={pendingDeleteIds !== null}
                onClose={() => setPendingDeleteIds(null)}
                title={
                    pendingCount === 1
                        ? "Fahrzeug löschen?"
                        : `${pendingCount} Fahrzeuge löschen?`
                }
                confirmLabel="Löschen"
                onConfirm={confirmDelete}
            >
                {pendingCount === 1 ? (
                    <p>
                        {pendingVehicle
                            ? `„${pendingVehicle.license_plate}“ wirklich löschen? Das kann nicht rückgängig gemacht werden.`
                            : "Dieses Fahrzeug wirklich löschen? Das kann nicht rückgängig gemacht werden."}
                    </p>
                ) : (
                    <p>
                        Diese {pendingCount} Fahrzeuge wirklich löschen? Das
                        kann nicht rückgängig gemacht werden.
                    </p>
                )}
            </ConfirmDialog>
        </section>
    );
};
