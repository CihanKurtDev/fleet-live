import { useCallback, useState } from "react";
import { serializeAlertListQuery, type Alert } from "@fleet-live/shared";

import { resolveAlerts } from "../../api/alerts";
import { ApiError } from "../../api/client";
import { useVehicles } from "../../context/vehiclesContext";
import { formatTimestamp } from "../../utils/dateTime";
import { Table } from "../ui/Table/Table";
import { TableFilterBar } from "../ui/Table/TableFilterBar";
import { TablePagination } from "../ui/Table/TablePagination";
import { RetryMessage } from "../ui/RetryMessage";
import { useServerTable } from "../../hooks/useServerTable";
import { useAlertList } from "../../hooks/useAlertList";
import { useAlertListQuery } from "../../hooks/useAlertListQuery";
import { alertFilters, alertTypeFilters } from "./alertTableConfig";
import { useAlertResolveColumn } from "./useAlertResolveColumn";
import { useAlertSelection } from "./useAlertSelection";
import { useStatusNotice } from "./useStatusNotice";
import { AlertBulkResolveDialog, AlertSelectionBar } from "./AlertBulkResolve";
import { resolvedNotice } from "./alertLabels";
import { ExportButton } from "../export/ExportButton";
import styles from "./AlertTable.module.scss";
import band from "../../styles/pageBand.module.scss";
import layout from "../../styles/layout.module.scss";

interface AlertTableProps {
    canWrite?: boolean;
    onSelectAlert?: (alert: Alert) => void;
}

export const AlertTable = ({
    canWrite = false,
    onSelectAlert,
}: AlertTableProps) => {
    const listQuery = useAlertListQuery();
    const listResult = useAlertList(listQuery.query);
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
    const selection = useAlertSelection(
        listResult.data,
        serializeAlertListQuery(listQuery.query).toString(),
    );
    const [pendingRows, setPendingRows] = useState<Alert[] | null>(null);
    const [bulkError, setBulkError] = useState<string | null>(null);
    const [isResolving, setIsResolving] = useState(false);
    const {
        query,
        setType,
        clearVehicle,
        clearDriver,
    } = listQuery;
    const { meta, notFound } = listResult;
    const {
        tableState,
        filtersWithCounts,
        extraFiltersWithCounts,
        paginatedRows,
        isLoading,
        error,
        pageCount,
        total,
        showPagination,
        sectionClassName,
        emptyContent,
        setFilter,
        handleSort,
        setPage,
        setLimit,
    } = useServerTable<Alert>({
        listQuery,
        listResult,
        filters: alertFilters,
        counts: listResult.meta?.counts,
        extras: {
            filters: alertTypeFilters,
            counts: listResult.meta?.type_counts,
        },
    });

    const selectable = canWrite && query.filter !== "resolved";
    const hasSelection = selectable && selection.count > 0;

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
            selection.clear();
            setPendingRows(null);
            refetchLists();
            showNotice(resolvedNotice(pendingRows.length));
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
            <section className={`${styles.alertTable} ${layout.sheet}`}>
            <header className={`${band.band} ${band.bleed}`}>
                <h1 className={styles.title}>Nicht gefunden</h1>
                <p className={styles.status}>
                    Es gibt kein Fahrzeug oder keinen Fahrer mit dieser Kennung
                    in deiner Firma.
                </p>
                <button
                    type="button"
                    className={styles.scopeButton}
                    onClick={() => {
                        clearVehicle();
                        clearDriver();
                    }}
                >
                    Alle Warnungen
                </button>
            </header>
            </section>
        );
    }

    return (
        <section
            className={sectionClassName(styles.alertTable, styles.isFetching)}
        >
            <header
                className={`${band.band} ${band.bleed} ${layout.pageHead}`}
            >
                <div className={styles.titleRow}>
                    <h1 className={styles.title}>Warnungen</h1>
                    {canWrite && (
                        <p
                            className={styles.notice}
                            role="status"
                            aria-live="polite"
                        >
                            {notice}
                        </p>
                    )}
                    {canWrite && <ExportButton kind="alerts" />}
                </div>

                {query.vehicle_id !== undefined && (
                    <p className={styles.scope}>
                        Nur Warnungen eines Fahrzeugs.{" "}
                        <button
                            type="button"
                            className={styles.scopeButton}
                            onClick={clearVehicle}
                        >
                            Alle Fahrzeuge
                        </button>
                    </p>
                )}

                {query.driver_id !== undefined && (
                    <p className={styles.scope}>
                        Nur Warnungen eines Fahrers.{" "}
                        <button
                            type="button"
                            className={styles.scopeButton}
                            onClick={clearDriver}
                        >
                            Alle Fahrer
                        </button>
                    </p>
                )}
            </header>

            <div className={layout.sheet}>
                {!isLoading && (
                    <div
                        className={
                            hasSelection
                                ? `${styles.filters} ${styles.filtersCovered}`
                                : styles.filters
                        }
                    >
                        {hasSelection && (
                            <AlertSelectionBar
                                rows={selection.selectedRows}
                                onClear={selection.clear}
                                onResolve={() =>
                                    setPendingRows(selection.selectedRows)
                                }
                            />
                        )}
                        <TableFilterBar
                            filters={filtersWithCounts}
                            activeFilterId={tableState.filterId}
                            onFilterChange={setFilter}
                            allCount={meta?.counts.all}
                            groupLabel="Status"
                            ariaLabel="Status"
                        />
                        <TableFilterBar
                            filters={extraFiltersWithCounts}
                            activeFilterId={query.type ?? null}
                            onFilterChange={setType}
                            allCount={meta?.type_counts?.all}
                            allLabel="Alle Typen"
                            groupLabel="Ereignisart"
                            ariaLabel="Ereignisart"
                        />
                    </div>
                )}

                {error && (
                    <RetryMessage message={error} onRetry={listResult.retry} />
                )}

                {actionError && (
                    <p className={styles.error} role="alert">
                        {actionError}
                    </p>
                )}

                {isLoading && (
                    <p className={styles.status} aria-live="polite">
                        Tabelle wird geladen…
                    </p>
                )}

                <Table
                    columns={columns}
                    rows={paginatedRows}
                    getRowKey={(alert) => alert.id}
                    selectable={selectable}
                    selectedRows={selection.selectedIds}
                    onSelectRow={(key) => selection.toggle(Number(key))}
                    isRowSelectable={selection.isSelectable}
                    getRowSelectLabel={(alert) =>
                        `Warnung ${alert.license_plate}, ${formatTimestamp(alert.created_at)} auswählen`
                    }
                    selectAll={{
                        checked: selection.allSelected,
                        indeterminate: selection.someSelected,
                        disabled: !selection.hasSelectable,
                        label: "Alle auf dieser Seite",
                        onChange: selection.toggleAll,
                    }}
                    onRowClick={onSelectAlert}
                    sortConfig={tableState.sortConfig}
                    onSort={handleSort}
                    caption="Warnungsliste"
                    isLoading={isLoading}
                    skeletonRowCount={Math.min(tableState.limit, 10)}
                    emptyContent={emptyContent(
                        query.filter === "open" &&
                            query.type === undefined &&
                            query.vehicle_id === undefined &&
                            query.driver_id === undefined
                            ? "Keine offenen Warnungen."
                            : "Keine Warnungen passen zum Filter.",
                    )}
                    className={styles.mobileCards}
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

                {canWrite && (
                    <AlertBulkResolveDialog
                        rows={pendingRows}
                        isBusy={isResolving}
                        error={bulkError}
                        onClose={closeBulkDialog}
                        onConfirm={() => void confirmBulkResolve()}
                    />
                )}
            </div>
        </section>
    );
};
