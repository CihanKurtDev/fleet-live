import { useMemo, useState, type ReactNode } from "react";
import { serializeDriverListQuery, type Driver } from "@fleet-live/shared";

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
import { ConfirmDialog } from "../ui/Modal/ConfirmDialog";
import { RetryMessage } from "../ui/RetryMessage";
import { deleteDriver } from "../../api/drivers";
import { useDriverList } from "../../hooks/useDriverList";
import {
    driverTileOf,
    useDriverListQuery,
} from "../../hooks/useDriverListQuery";
import { useListPageSize } from "../../hooks/useListPageSize";
import { useSelectionMode } from "../../hooks/useSelectionMode";
import { useServerTable } from "../../hooks/useServerTable";
import { useStatusNotice } from "../../hooks/useStatusNotice";
import { formatCount } from "../../utils/formatCount";
import { driverColumns, driverTileOptions } from "./driverTableConfig";
import {
    deleteErrorMessage,
    driverCountText,
    driverDeleteTitle,
} from "./driverDelete";
import styles from "./DriverTable.module.scss";

interface DriverTableProps {
    /** Header actions for dispatchers ("Fahrer anlegen"). */
    actions?: ReactNode;
    /** First steps in the list of a company without drivers. Dispatchers only. */
    emptyActions?: ReactNode;
    /** Enables "Auswählen" and bulk delete. Dispatchers only. */
    canDelete?: boolean;
    /** Called after drivers were deleted, to refetch the lists. */
    onDeleted?: () => void;
    /** Status line to show once on arrival (after deleting on the detail page). */
    initialNotice?: string | null;
    /** Row click: opens the driver. */
    onSelectDriver?: (driver: Driver) => void;
}

/** `/drivers`: header, tiles, the list panel. */
export const DriverTable = ({
    actions,
    emptyActions,
    canDelete = false,
    onDeleted,
    initialNotice = null,
    onSelectDriver,
}: DriverTableProps) => {
    const listQuery = useDriverListQuery();
    const { ref: bodyRef, pageSize } = useListPageSize(listQuery.query.limit);
    const listResult = useDriverList({
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
        handleSort,
        setPage,
    } = useServerTable<Driver>({ listQuery, listResult });
    const { notice, show: showNotice } = useStatusNotice();
    const [shownInitial, setShownInitial] = useState(false);

    if (initialNotice && !shownInitial) {
        setShownInitial(true);
        showNotice(initialNotice);
    }

    const rowKeys = useMemo(
        () => paginatedRows.map((driver) => driver.id),
        [paginatedRows],
    );
    const selection = useSelectionMode(
        rowKeys,
        serializeDriverListQuery({
            ...listQuery.query,
            limit: pageSize,
        }).toString(),
    );

    const [pendingDelete, setPendingDelete] = useState<Driver[] | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const activeTile = driverTileOf(listQuery.query);
    const hasSearch = tableState.search.trim().length > 0;
    const isFiltered = activeTile !== "all" || hasSearch;
    const isDefaultSort =
        listQuery.query.sort === undefined ||
        (listQuery.query.sort === "open_warnings" &&
            listQuery.query.dir === "desc");

    // Tiles leave `counts.all` alone; only the search narrows it.
    const noDrivers = counts !== undefined && !hasSearch && counts.all === 0;

    const summary = noDrivers
        ? "Noch keine Fahrer in dieser Firma."
        : counts
        ? [
              hasSearch
                  ? `${formatCount(counts.all)} Treffer`
                  : driverCountText(counts.all),
              isDefaultSort ? "sortiert nach offenen Tempo-Warnungen" : null,
          ]
              .filter(Boolean)
              .join(" · ")
        : null;

    const tiles: KpiTile[] = driverTileOptions.map((tile) => ({
        key: tile.id,
        label: tile.label,
        value: counts ? counts[tile.count] : null,
        hint: tile.hint,
        tone: tile.tone,
        pressed: activeTile === tile.id,
        onToggle: () => listQuery.setTile(tile.id),
    }));

    const closeDelete = () => {
        setPendingDelete(null);
        setDeleteError(null);
    };

    const confirmDelete = async () => {
        if (!pendingDelete) {
            return;
        }

        setDeleteError(null);
        setIsDeleting(true);

        const results = await Promise.allSettled(
            pendingDelete.map((driver) => deleteDriver(driver.id)),
        );
        const failed: Driver[] = [];
        const failures: string[] = [];
        let deleted = 0;

        results.forEach((result, index) => {
            if (result.status === "fulfilled") {
                deleted += 1;
            } else {
                failed.push(pendingDelete[index]);
                failures.push(deleteErrorMessage(result.reason));
            }
        });

        setIsDeleting(false);

        if (deleted > 0) {
            onDeleted?.();
        }

        if (failed.length === 0) {
            setPendingDelete(null);
            selection.stop();
            showNotice(`${deleted} Fahrer gelöscht.`);
            return;
        }

        // Deleted drivers leave the page with the refetch; the failed ones
        // stay selected and are listed in the dialog with the reason.
        setPendingDelete(failed);
        setDeleteError([...new Set(failures)].join(" "));
        if (deleted > 0) {
            showNotice(`${deleted} Fahrer gelöscht.`);
        }
    };

    const pendingCount = pendingDelete?.length ?? 0;

    return (
        <ListPage selecting={selection.active} busy={isRefreshing}>
            <ListPageHeader
                title="Fahrer"
                summary={summary}
                notice={notice}
                actions={actions}
            />

            <KpiTiles
                ariaLabel="Filter"
                phoneLayout="strip"
                tiles={tiles}
                tip="list-tiles"
            />

            <ListPanel label="Fahrerliste">
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
                                        paginatedRows.filter((driver) =>
                                            selection.selectedIds.includes(
                                                driver.id,
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
                            canDelete ? selection.start : undefined
                        }
                        disabled={noDrivers}
                        search={{
                            value: tableState.search,
                            onChange: setSearch,
                            placeholder: "Fahrer suchen",
                            ariaLabel: "Fahrer suchen",
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
                        columns={driverColumns}
                        rows={paginatedRows}
                        getRowKey={(driver) => driver.id}
                        selectionMode={selection.active}
                        selectedRows={selection.selectedIds}
                        onSelectRow={(key) => selection.toggle(Number(key))}
                        getRowSelectLabel={(driver) =>
                            `${driver.name} auswählen`
                        }
                        onRowClick={onSelectDriver}
                        sortConfig={tableState.sortConfig}
                        onSort={handleSort}
                        caption="Fahrerliste"
                        isLoading={isLoading}
                        skeletonRowCount={pageSize}
                        emptyContent={emptyContent(
                            noDrivers ? (
                                <ListEmpty
                                    title="Noch keine Fahrer"
                                    message={
                                        emptyActions
                                            ? "Fahrer kommen mit dem Excel-Import (Blatt Fahrer, dazu Freigaben und Besatzung) oder einzeln."
                                            : "Ein Dispatcher deiner Firma legt die Fahrer an. Danach siehst du hier alles live."
                                    }
                                    actions={emptyActions}
                                />
                            ) : isFiltered ? (
                                <ListEmpty
                                    message="Keine Fahrer passen zu Suche und Filter."
                                    onClearFilters={listQuery.clearFilters}
                                />
                            ) : (
                                <ListEmpty message="Keine Fahrer vorhanden." />
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
                title={driverDeleteTitle(pendingCount)}
                confirmLabel={`${pendingCount} löschen`}
                busyLabel="Wird gelöscht…"
                isBusy={isDeleting}
                onConfirm={confirmDelete}
                itemsLabel="Ausgewählte Fahrer"
                items={pendingDelete?.map((driver) => ({
                    key: driver.id,
                    name: driver.name,
                    detail: driver.current_vehicle_plate ?? "kein Fahrzeug",
                }))}
                error={deleteError}
            >
                <p>
                    {pendingCount === 1
                        ? "Diesen Fahrer wirklich löschen?"
                        : `Diese ${pendingCount} Fahrer wirklich löschen?`}{" "}
                    Das kann nicht rückgängig gemacht werden.
                </p>
            </ConfirmDialog>
        </ListPage>
    );
};
