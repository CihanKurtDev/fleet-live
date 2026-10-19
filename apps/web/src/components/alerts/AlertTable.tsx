import { useCallback, useMemo, useState } from "react";
import {
    isSelfClosingAlertType,
    serializeAlertListQuery,
    type Alert,
} from "@fleet-live/shared";

import { resolveAlerts } from "../../api/alerts";
import { ApiError } from "../../api/client";
import { useVehicles } from "../../context/vehiclesContext";
import { useAlertList } from "../../hooks/useAlertList";
import { useAlertListQuery } from "../../hooks/useAlertListQuery";
import { useListPageSize } from "../../hooks/useListPageSize";
import { useSelectionMode } from "../../hooks/useSelectionMode";
import { useServerTable } from "../../hooks/useServerTable";
import { useStatusNotice } from "../../hooks/useStatusNotice";
import { formatTimestamp } from "../../utils/dateTime";
import { formatCount } from "../../utils/formatCount";
import { ExportButton } from "../export/ExportButton";
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
import { RetryMessage } from "../ui/RetryMessage";
import { Table } from "../ui/Table/Table";
import { AlertBulkResolveDialog } from "./AlertBulkResolve";
import { resolvedNotice, selectionSummary } from "./alertLabels";
import {
    activeAlertTile,
    alertTileCount,
    alertTiles,
    canResolveByHand,
} from "./alertTableConfig";
import { useAlertResolveColumn } from "./useAlertResolveColumn";
import { useOpenTypeCounts } from "./useOpenTypeCounts";
import styles from "./AlertTable.module.scss";

interface AlertTableProps {
    /** Dispatchers: Exportieren, Auswählen, Erledigen. */
    canWrite?: boolean;
    /** Row click: opens the alert's vehicle. */
    onSelectAlert?: (alert: Alert) => void;
}

/** `/alerts`: header, status tiles, the list panel. */
export const AlertTable = ({
    canWrite = false,
    onSelectAlert,
}: AlertTableProps) => {
    const listQuery = useAlertListQuery();
    const { ref: bodyRef, pageSize } = useListPageSize(listQuery.query.limit);
    const listResult = useAlertList({ ...listQuery.query, limit: pageSize });
    const { refetchLists } = useVehicles();
    const { notice, show: showNotice } = useStatusNotice();
    const onSingleResolved = useCallback(
        () => showNotice(resolvedNotice(1)),
        [showNotice],
    );
    const { columns, actionError } = useAlertResolveColumn(
        canWrite,
        onSingleResolved,
    );
    const { query, setView, clearFilters, clearVehicle, clearDriver } =
        listQuery;
    const { meta, notFound } = listResult;
    const openTypeCounts = useOpenTypeCounts(meta, query.filter);
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
        handleSort,
        setPage,
    } = useServerTable<Alert>({ listQuery, listResult });

    // Nothing to select on Erledigt, nor on Wenig Tank and Kein Signal (they close
    // themselves).
    const selectable =
        canWrite &&
        query.filter !== "resolved" &&
        !(query.type && isSelfClosingAlertType(query.type));
    const openRows = useMemo(
        () => paginatedRows.filter(canResolveByHand),
        [paginatedRows],
    );
    const rowKeys = useMemo(() => openRows.map((row) => row.id), [openRows]);
    const selection = useSelectionMode(
        rowKeys,
        serializeAlertListQuery({ ...query, limit: pageSize }).toString(),
    );
    const selecting = selectable && selection.active;
    const selectedRows = useMemo(
        () => openRows.filter((row) => selection.selectedIds.includes(row.id)),
        [openRows, selection.selectedIds],
    );

    const [pendingRows, setPendingRows] = useState<Alert[] | null>(null);
    const [bulkError, setBulkError] = useState<string | null>(null);
    const [isResolving, setIsResolving] = useState(false);

    const closeBulkDialog = () => {
        setPendingRows(null);
        setBulkError(null);
    };

    const confirmBulkResolve = async () => {
        if (!pendingRows) {
            return;
        }

        setBulkError(null);
        setIsResolving(true);

        try {
            await resolveAlerts(pendingRows.map((row) => row.id));
            const count = pendingRows.length;
            setPendingRows(null);
            selection.stop();
            refetchLists();
            showNotice(resolvedNotice(count));
        } catch (caught: unknown) {
            setBulkError(
                caught instanceof ApiError
                    ? caught.message
                    : "Warnungen konnten nicht erledigt werden.",
            );
        } finally {
            setIsResolving(false);
        }
    };

    if (notFound) {
        return (
            <ListPage>
                <ListPageHeader
                    title="Nicht gefunden"
                    summary="Es gibt kein Fahrzeug oder keinen Fahrer mit dieser Kennung in deiner Firma."
                    actions={
                        <Button
                            variant="secondary"
                            size="toolbar"
                            onClick={() => {
                                clearVehicle();
                                clearDriver();
                            }}
                        >
                            Alle Warnungen
                        </Button>
                    }
                />
            </ListPage>
        );
    }

    const hasScope =
        query.vehicle_id !== undefined || query.driver_id !== undefined;
    const activeTile = activeAlertTile(query);
    const isFiltered = activeTile !== "open" || hasScope;
    const counts = meta?.counts;

    const summary = (
        <>
            {counts
                ? `${formatCount(counts.open)} offen · ${formatCount(counts.resolved)} erledigt · neueste zuerst`
                : "Warnungen der Firma"}
            {query.vehicle_id !== undefined && (
                <>
                    {" · "}Nur Warnungen eines Fahrzeugs.{" "}
                    <button
                        type="button"
                        className={styles.scopeButton}
                        onClick={clearVehicle}
                    >
                        Alle Fahrzeuge
                    </button>
                </>
            )}
            {query.driver_id !== undefined && (
                <>
                    {" · "}Nur Warnungen eines Fahrers.{" "}
                    <button
                        type="button"
                        className={styles.scopeButton}
                        onClick={clearDriver}
                    >
                        Alle Fahrer
                    </button>
                </>
            )}
        </>
    );

    const tiles: KpiTile[] = alertTiles.map((tile) => ({
        key: tile.id,
        label: tile.label,
        value: alertTileCount(tile.id, counts, openTypeCounts),
        tone: tile.tone,
        pressed: activeTile === tile.id,
        onToggle: () => {
            selection.stop();
            setView(tile.view);
        },
    }));

    return (
        <ListPage selecting={selecting} busy={isRefreshing}>
            <ListPageHeader
                title="Warnungen"
                summary={summary}
                notice={notice}
                actions={canWrite ? <ExportButton kind="alerts" size="toolbar" /> : undefined}
            />

            <KpiTiles
                ariaLabel="Status"
                phoneLayout="strip"
                tiles={tiles}
                tip="list-tiles"
            />

            <ListPanel label="Warnungsliste">
                {selecting ? (
                    <SelectionBar
                        count={selection.count}
                        pageCheckbox={selection.pageCheckbox}
                        summary={
                            selectedRows.length > 0
                                ? selectionSummary(selectedRows)
                                : undefined
                        }
                        onDone={selection.stop}
                        actions={
                            <Button
                                variant="primary"
                                size="toolbar"
                                disabled={selection.count === 0}
                                onClick={() => setPendingRows(selectedRows)}
                            >
                                {selection.count} erledigen
                            </Button>
                        }
                    />
                ) : (
                    <ListToolbar
                        onStartSelection={
                            selectable ? selection.start : undefined
                        }
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

                {actionError && (
                    <p className={styles.error} role="alert">
                        {actionError}
                    </p>
                )}

                <ListBody ref={bodyRef}>
                    <Table
                        columns={columns}
                        rows={paginatedRows}
                        getRowKey={(alert) => alert.id}
                        selectionMode={selecting}
                        selectedRows={selection.selectedIds}
                        onSelectRow={(key) => selection.toggle(Number(key))}
                        isRowSelectable={canResolveByHand}
                        getRowSelectLabel={(alert) =>
                            `Warnung ${alert.license_plate}, ${formatTimestamp(alert.created_at)} auswählen`
                        }
                        onRowClick={onSelectAlert}
                        sortConfig={tableState.sortConfig}
                        onSort={handleSort}
                        caption="Warnungsliste"
                        isLoading={isLoading}
                        skeletonRowCount={pageSize}
                        emptyContent={emptyContent(
                            isFiltered ? (
                                <ListEmpty
                                    message="Keine Warnungen passen zum Filter."
                                    onClearFilters={clearFilters}
                                />
                            ) : (
                                <ListEmpty message="Keine offenen Warnungen." />
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

            {canWrite && (
                <AlertBulkResolveDialog
                    rows={pendingRows}
                    isBusy={isResolving}
                    error={bulkError}
                    onClose={closeBulkDialog}
                    onConfirm={() => void confirmBulkResolve()}
                />
            )}
        </ListPage>
    );
};
