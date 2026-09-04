import type { Alert } from "@fleet-live/shared";

import { Table } from "../ui/Table/Table";
import { TableFilterBar } from "../ui/Table/TableFilterBar";
import { TablePagination } from "../ui/Table/TablePagination";
import { useServerTable } from "../../hooks/useServerTable";
import { useAlertList } from "../../hooks/useAlertList";
import { useAlertListQuery } from "../../hooks/useAlertListQuery";
import { alertFilters, alertTypeFilters } from "./alertTableConfig";
import { useAlertResolveColumn } from "./useAlertResolveColumn";
import styles from "./AlertTable.module.scss";

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
    const { columns, actionError } = useAlertResolveColumn(canWrite);
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

    if (notFound) {
        return (
            <section className={styles.alertTable}>
                <h1 className={styles.title}>Nicht gefunden</h1>
                <p className={styles.status}>
                    Es gibt kein Fahrzeug oder keinen Fahrer mit dieser Kennung
                    in Ihrer Firma.
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
            </section>
        );
    }

    return (
        <section
            className={sectionClassName(styles.alertTable, styles.isFetching)}
        >
            <h1 className={styles.title}>Warnungen</h1>

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

            {!isLoading && (
                <div className={styles.filters}>
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

            {(error || actionError) && (
                <p className={styles.error} role="alert">
                    {error ?? actionError}
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
        </section>
    );
};
