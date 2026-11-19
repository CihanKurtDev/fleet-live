import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router";
import {
    DRIVER_TALK_MIN_OPEN_WARNINGS,
    LIST_PAGE_LIMIT_MAX,
    serializeAlertListQuery,
    type Alert,
} from "@fleet-live/shared";

import { resolveAlerts, resolveAlertsMatching } from "../../api/alerts";
import { ApiError } from "../../api/client";
import { useVehicles } from "../../context/vehiclesContext";
import { useAlertList } from "../../hooks/useAlertList";
import { useAlertListQuery } from "../../hooks/useAlertListQuery";
import { useAuth } from "../../hooks/useAuth";
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
import { resolvedNotice } from "./alertLabels";
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
    const { ref: bodyRef, pageSize: fitted } = useListPageSize(listQuery.query.limit);
    // 10 is "no choice made": the list shows what fits the window.
    const pageSize = listQuery.query.limit === 10 ? fitted : listQuery.query.limit;
    const limitOptions = [...new Set([fitted, 25, 50, LIST_PAGE_LIMIT_MAX])].sort((a, b) => a - b);
    const listResult = useAlertList({ ...listQuery.apiQuery, limit: pageSize });
    const namesHidden = useAuth().user?.driver_names_hidden ?? false;
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
        setSearch,
        handleSort,
        setPage,
    } = useServerTable<Alert>({ listQuery, listResult });

    // Only on Tempo: every row there can be closed by hand, so the number on
    // the tile, in the footer and in the selection bar is the same number.
    // Wenig Tank and Kein Signal close themselves.
    const selectable = canWrite && query.filter === "open" && query.type === "SPEEDING";
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
    // "Alle N" stays on while paging; the list it means is everything but the page.
    const wholeList = serializeAlertListQuery({ ...listQuery.apiQuery, page: 1, limit: 10 }).toString();
    const [allOf, setAllOf] = useState<string | null>(null);
    const allSelected = selecting && allOf === wholeList;
    const pageFull = selection.pageCheckbox.checked;
    const offerAll = selecting && !allSelected && pageFull && total > openRows.length;
    const selectedCount = allSelected ? total : selection.count;
    const selectionLabel = allSelected
        ? `Alle ${formatCount(total)} ausgewählt`
        : offerAll
          ? `${formatCount(selection.count)} auf dieser Seite ausgewählt`
          : `${formatCount(selection.count)} ausgewählt`;
    const endSelection = () => {
        setAllOf(null);
        selection.stop();
    };

    const [pendingRows, setPendingRows] = useState<Alert[] | null>(null);
    const [pendingAll, setPendingAll] = useState(false);
    const [bulkError, setBulkError] = useState<string | null>(null);
    const [isResolving, setIsResolving] = useState(false);

    const closeBulkDialog = () => {
        setPendingRows(null);
        setPendingAll(false);
        setBulkError(null);
    };

    const confirmBulkResolve = async () => {
        if (!pendingRows) {
            return;
        }

        setBulkError(null);
        setIsResolving(true);

        try {
            const { data } = pendingAll
                ? await resolveAlertsMatching(
                      {
                          type: "SPEEDING",
                          vehicle_id: query.vehicle_id,
                          driver_id: query.driver_id,
                          search: listQuery.apiQuery.search,
                      },
                      total,
                  )
                : await resolveAlerts(pendingRows.map((row) => row.id));
            closeBulkDialog();
            endSelection();
            refetchLists();
            showNotice(resolvedNotice(data.resolved));
        } catch (caught: unknown) {
            setBulkError(
                caught instanceof ApiError
                    ? caught.message
                    : "Warnungen konnten nicht erledigt werden.",
            );
            // The list moved on: the next confirmation counts the new number.
            refetchLists();
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

    const hasSearch = query.search.trim() !== "";
    const hasScope =
        query.vehicle_id !== undefined || query.driver_id !== undefined || hasSearch;
    const activeTile = activeAlertTile(query);
    const isFiltered = activeTile !== "open" || hasScope;
    const counts = meta?.counts;
    // Never a warning in this company (or none yet in a new one): not the
    // same as "Keine offenen Warnungen", which says the inbox is cleared.
    const noAlerts = counts !== undefined && !hasScope && counts.all === 0;
    const talkDrivers = hasScope ? 0 : (meta?.talk_drivers ?? 0);

    const summary = (
        <>
            {noAlerts
                ? "Noch keine Warnungen."
                : counts && meta
                ? // What „Erledigen“ does: cleared, then kept for the
                  // company's retention.
                  `${formatCount(counts.open)} offen · ${formatCount(counts.resolved)} erledigt. Erledigt heißt geklärt; die Warnung bleibt ${meta.resolved_kept_days} Tage im Verlauf.`
                : "Warnungen der Firma"}
            {talkDrivers > 0 && (
                <>
                    {" · "}
                    <Link className={styles.scopeButton} to={`/drivers?min_open_warnings=${DRIVER_TALK_MIN_OPEN_WARNINGS}`}>
                        {formatCount(talkDrivers)} Fahrer mit {DRIVER_TALK_MIN_OPEN_WARNINGS} oder mehr offenen Tempo-Warnungen
                    </Link>
                </>
            )}
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
        hint: tile.hint,
        value: alertTileCount(tile.id, counts, openTypeCounts),
        tone: tile.tone,
        pressed: activeTile === tile.id,
        onToggle: () => {
            endSelection();
            setView(tile.view);
        },
    }));

    return (
        <ListPage selecting={selecting} busy={isRefreshing}>
            <ListPageHeader
                title="Warnungen"
                summary={summary}
                notice={notice}
                actions={
                    canWrite ? (
                        <ExportButton
                            kind="alerts"
                            size="toolbar"
                            disabled={noAlerts}
                        />
                    ) : undefined
                }
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
                        count={selectedCount}
                        countLabel={selectionLabel}
                        pageCheckbox={
                            allSelected
                                ? { checked: true, indeterminate: false, onChange: () => setAllOf(null) }
                                : selection.pageCheckbox
                        }
                        summary={
                            offerAll ? (
                                <button
                                    type="button"
                                    className={styles.scopeButton}
                                    onClick={() => setAllOf(wholeList)}
                                >
                                    Alle {formatCount(total)} auswählen
                                </button>
                            ) : undefined
                        }
                        onDone={endSelection}
                        actions={
                            <Button
                                variant="primary"
                                size="toolbar"
                                disabled={selectedCount === 0}
                                onClick={() => {
                                    setPendingAll(allSelected);
                                    setPendingRows(allSelected ? openRows : selectedRows);
                                }}
                            >
                                {formatCount(selectedCount)} erledigen
                            </Button>
                        }
                    />
                ) : (
                    <ListToolbar
                        onStartSelection={
                            selectable ? selection.start : undefined
                        }
                        disabled={noAlerts}
                        search={{
                            value: tableState.search,
                            onChange: setSearch,
                            placeholder: namesHidden ? "Kennzeichen suchen" : "Fahrer oder Kennzeichen suchen",
                            ariaLabel: namesHidden ? "Kennzeichen suchen" : "Fahrer oder Kennzeichen suchen",
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
                        selectedRows={allSelected ? rowKeys : selection.selectedIds}
                        onSelectRow={(key) => {
                            if (allSelected) {
                                setAllOf(null);
                                selection.select(rowKeys.filter((id) => id !== Number(key)));
                                return;
                            }

                            selection.toggle(Number(key));
                        }}
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
                            noAlerts ? (
                                <ListEmpty
                                    title="Noch keine Warnungen"
                                    message="Warnungen entstehen von selbst: wenn ein Fahrzeug zu schnell fährt, der Tank unter 15 % fällt oder das Signal fehlt."
                                />
                            ) : isFiltered ? (
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
                    onLimitChange={(limit) => listQuery.setLimit(limit === fitted ? 10 : limit)}
                    limitOptions={limitOptions}
                    show={showPagination}
                />
            </ListPanel>

            {canWrite && (
                <AlertBulkResolveDialog
                    rows={pendingRows}
                    count={pendingAll ? total : (pendingRows?.length ?? 0)}
                    isBusy={isResolving}
                    error={bulkError}
                    onClose={closeBulkDialog}
                    onConfirm={() => void confirmBulkResolve()}
                />
            )}
        </ListPage>
    );
};
