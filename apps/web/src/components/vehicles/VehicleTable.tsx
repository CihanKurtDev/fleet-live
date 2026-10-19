import { useMemo, useState, type ReactNode } from "react";
import {
    serializeVehicleListQuery,
    VEHICLE_TYPE_LABELS,
    type Vehicle,
} from "@fleet-live/shared";

import { Table } from "../ui/Table/Table";
import { Button } from "../ui/Button/Button";
import { KpiTiles, type KpiTile } from "../ui/KpiTiles/KpiTiles";
import {
    ListBody,
    ListEmpty,
    ListFooter,
    ListPage,
    ListPageHeader,
    ListPanel,
    ListToolbar,
    SelectionBar,
} from "../ui/ListPage/ListPage";
import { MenuButton } from "../ui/Menu/MenuButton";
import { ConfirmDialog } from "../ui/Modal/ConfirmDialog";
import { RetryMessage } from "../ui/RetryMessage";
import { useListPageSize } from "../../hooks/useListPageSize";
import { useSelectionMode } from "../../hooks/useSelectionMode";
import { useServerTable } from "../../hooks/useServerTable";
import { useStatusNotice } from "../../hooks/useStatusNotice";
import { useVehicleList } from "../../hooks/useVehicleList";
import { useVehicleListQuery } from "../../hooks/useVehicleListQuery";
import { formatCount } from "../../utils/formatCount";
import {
    vehicleColumns,
    vehicleMoreFilters,
    vehicleTileFilters,
} from "./vehicleTableConfig";
import { vehicleStatusLabel } from "./vehicleStatus";
import styles from "./VehicleTable.module.scss";

interface VehicleTableProps {
    /** Header actions for dispatchers (Importieren, Exportieren, anlegen). */
    actions?: ReactNode;
    /** Enables "Auswählen" and bulk delete. Dispatchers only. */
    onDeleteVehicles?: (ids: number[]) => Promise<void>;
    /** Row click: opens the vehicle. */
    onSelectVehicle?: (vehicle: Vehicle) => void;
    /** Message from the page, for example after "Fahrzeug anlegen". */
    pageNotice?: string | null;
}

const vehicleCount = (count: number) =>
    `${formatCount(count)} ${count === 1 ? "Fahrzeug" : "Fahrzeuge"}`;

/** `/vehicles`: header, status tiles, the list panel. */
export const VehicleTable = ({
    actions,
    onDeleteVehicles,
    onSelectVehicle,
    pageNotice,
}: VehicleTableProps) => {
    const listQuery = useVehicleListQuery();
    const { ref: bodyRef, pageSize } = useListPageSize(listQuery.query.limit);
    const listResult = useVehicleList({
        ...listQuery.apiQuery,
        limit: pageSize,
    });
    const counts = listResult.meta?.counts;
    const {
        tableState,
        paginatedRows,
        isLoading,
        isRefreshing,
        error,
        pageCount,
        total,
        showPagination,
        emptyContent,
        setSearch,
        setFilter,
        handleSort,
        setPage,
    } = useServerTable<Vehicle>({ listQuery, listResult });
    const { notice, show: showNotice } = useStatusNotice();

    const rowKeys = useMemo(
        () => paginatedRows.map((vehicle) => vehicle.id),
        [paginatedRows],
    );
    const selection = useSelectionMode(
        rowKeys,
        serializeVehicleListQuery({
            ...listQuery.query,
            limit: pageSize,
        }).toString(),
    );

    const [pendingDelete, setPendingDelete] = useState<Vehicle[] | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const activeFilter = tableState.filterId;
    const hasSearch = tableState.search.trim().length > 0;
    const isFiltered = activeFilter !== null || hasSearch;

    const summary = counts
        ? [
              hasSearch
                  ? `${formatCount(counts.all)} Treffer`
                  : `${formatCount(counts.all)} im Bestand`,
              `${formatCount(counts.alerts)} mit offener Warnung`,
              `${formatCount(counts.unassigned)} ohne Fahrer`,
          ].join(" · ")
        : null;

    const tiles: KpiTile[] = vehicleTileFilters.map((filter) => ({
        key: filter.id ?? "all",
        label: filter.label,
        value: counts ? counts[filter.count] : null,
        tone: filter.tone,
        pressed: activeFilter === filter.id,
        onToggle: () => setFilter(filter.id),
    }));

    const activeMore = vehicleMoreFilters.find(
        (filter) => filter.id === activeFilter,
    );

    const closeDelete = () => {
        setPendingDelete(null);
        setDeleteError(null);
    };

    const confirmDelete = async () => {
        if (!pendingDelete || !onDeleteVehicles) {
            return;
        }

        setDeleteError(null);
        setIsDeleting(true);

        try {
            await onDeleteVehicles(pendingDelete.map((vehicle) => vehicle.id));
            const count = pendingDelete.length;
            setPendingDelete(null);
            selection.stop();
            showNotice(`${vehicleCount(count)} gelöscht.`);
        } catch (caught: unknown) {
            setDeleteError(
                caught instanceof Error
                    ? caught.message
                    : "Fahrzeuge konnten nicht gelöscht werden.",
            );
        } finally {
            setIsDeleting(false);
        }
    };

    const pendingCount = pendingDelete?.length ?? 0;

    return (
        <ListPage selecting={selection.active} busy={isRefreshing}>
            <ListPageHeader
                title="Fahrzeuge"
                summary={summary}
                notice={notice ?? pageNotice}
                actions={actions}
            />

            <KpiTiles
                ariaLabel="Status"
                phoneLayout="strip"
                tiles={tiles}
                tip="list-tiles"
            />

            <ListPanel label="Fahrzeugliste">
                {selection.active ? (
                    <SelectionBar
                        count={selection.count}
                        pageCheckbox={selection.pageCheckbox}
                        onDone={selection.stop}
                        actions={
                            <Button
                                variant="dangerOutline"
                                size="toolbar"
                                disabled={selection.count === 0}
                                onClick={() =>
                                    setPendingDelete(
                                        paginatedRows.filter((vehicle) =>
                                            selection.selectedIds.includes(
                                                vehicle.id,
                                            ),
                                        ),
                                    )
                                }
                            >
                                {selection.count} löschen
                            </Button>
                        }
                    />
                ) : (
                    <ListToolbar
                        onStartSelection={
                            onDeleteVehicles ? selection.start : undefined
                        }
                        filters={
                            <MenuButton
                                label={activeMore?.label ?? "Weitere Filter"}
                                ariaLabel={
                                    activeMore
                                        ? `Weitere Filter: ${activeMore.label}`
                                        : "Weitere Filter"
                                }
                                menuLabel="Weitere Filter"
                                align="start"
                                active={activeMore !== undefined}
                                items={vehicleMoreFilters.map((filter) => ({
                                    key: filter.id ?? "all",
                                    checked: activeFilter === filter.id,
                                    label: (
                                        <>
                                            <span>{filter.label}</span>
                                            {counts && (
                                                <span className={styles.menuCount}>
                                                    {formatCount(
                                                        counts[filter.count],
                                                    )}
                                                </span>
                                            )}
                                        </>
                                    ),
                                    onSelect: () =>
                                        setFilter(
                                            activeFilter === filter.id
                                                ? null
                                                : filter.id,
                                        ),
                                }))}
                            />
                        }
                        search={{
                            value: tableState.search,
                            onChange: setSearch,
                            placeholder: "Kennzeichen oder Fahrer",
                            ariaLabel: "Kennzeichen oder Fahrer suchen",
                        }}
                    />
                )}

                {error && (
                    <div className={styles.error}>
                        <RetryMessage
                            message={error}
                            onRetry={listResult.retry}
                        />
                    </div>
                )}

                <ListBody ref={bodyRef}>
                    <Table
                        columns={vehicleColumns}
                        rows={paginatedRows}
                        getRowKey={(vehicle) => vehicle.id}
                        selectionMode={selection.active}
                        selectedRows={selection.selectedIds}
                        onSelectRow={(key) => selection.toggle(Number(key))}
                        getRowSelectLabel={(vehicle) =>
                            `${vehicle.license_plate} auswählen`
                        }
                        onRowClick={onSelectVehicle}
                        sortConfig={tableState.sortConfig}
                        onSort={handleSort}
                        caption="Fahrzeugliste"
                        isLoading={isLoading}
                        skeletonRowCount={pageSize}
                        emptyContent={emptyContent(
                            isFiltered ? (
                                <ListEmpty
                                    message="Keine Fahrzeuge passen zu Suche und Filter."
                                    onClearFilters={listQuery.clearFilters}
                                />
                            ) : (
                                <ListEmpty message="Keine Fahrzeuge vorhanden." />
                            ),
                        )}
                        className={styles.cards}
                    />
                </ListBody>

                <ListFooter
                    page={tableState.page}
                    pageCount={pageCount}
                    limit={pageSize}
                    total={total}
                    onPageChange={setPage}
                    show={showPagination}
                />
            </ListPanel>

            <ConfirmDialog
                open={pendingDelete !== null}
                onClose={closeDelete}
                title={`${vehicleCount(pendingCount)} löschen?`}
                confirmLabel={`${pendingCount} löschen`}
                busyLabel="Wird gelöscht…"
                isBusy={isDeleting}
                onConfirm={confirmDelete}
                itemsLabel="Ausgewählte Fahrzeuge"
                items={pendingDelete?.map((vehicle) => ({
                    key: vehicle.id,
                    name: vehicle.license_plate,
                    detail: [
                        vehicle.vehicle_type
                            ? VEHICLE_TYPE_LABELS[vehicle.vehicle_type]
                            : null,
                        vehicleStatusLabel(vehicle.status),
                    ]
                        .filter(Boolean)
                        .join(" · "),
                }))}
                error={deleteError}
            >
                <p>
                    {pendingCount === 1
                        ? "Dieses Fahrzeug wirklich löschen?"
                        : `Diese ${pendingCount} Fahrzeuge wirklich löschen?`}{" "}
                    Das kann nicht rückgängig gemacht werden.
                </p>
            </ConfirmDialog>
        </ListPage>
    );
};
