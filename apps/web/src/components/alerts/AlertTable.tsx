import { useMemo, useState, type MouseEvent } from "react";
import type { Alert } from "@fleet-live/shared";

import { Table } from "../ui/Table/Table";
import { TableFilterBar } from "../ui/Table/TableFilterBar";
import { TablePagination } from "../ui/Table/TablePagination";
import { Button } from "../ui/Button/Button";
import { useTable } from "../../hooks/useTable";
import { useAlertList } from "../../hooks/useAlertList";
import { useAlertListQuery } from "../../hooks/useAlertListQuery";
import { useVehicles } from "../../context/vehiclesContext";
import { resolveAlert } from "../../api/alerts";
import { ApiError } from "../../api/client";
import { formatTimestamp } from "../../utils/dateTime";
import type { TableColumn } from "../../types/table";
import { alertColumns, alertFilters, alertTypeFilters } from "./alertTableConfig.tsx";
import styles from "./AlertTable.module.scss";

interface AlertTableProps {
    canWrite?: boolean;
    onSelectAlert?: (alert: Alert) => void;
}

export const AlertTable = ({
    canWrite = false,
    onSelectAlert,
}: AlertTableProps) => {
    const {
        query,
        tableState,
        setFilter,
        setType,
        handleSort,
        setPage,
        setLimit,
        clearVehicle,
        clearDriver,
    } = useAlertListQuery();

    const {
        data,
        meta,
        isLoading,
        isFetching,
        error,
        notFound,
        pageCount,
        total,
    } = useAlertList(query);
    const { refetchLists } = useVehicles();

    const { filtersWithCounts, paginatedRows } = useTable({
        rows: data,
        filters: alertFilters,
        counts: meta?.counts,
        pageCount,
        total,
        tableState,
        setSearch: () => undefined,
        setFilter,
        handleSort,
        setPage,
        setLimit,
    });

    const typeFiltersWithCounts = useMemo(
        () =>
            alertTypeFilters.map((filter) => ({
                ...filter,
                count: meta?.type_counts?.[filter.id] ?? 0,
            })),
        [meta?.type_counts],
    );

    const [resolvingId, setResolvingId] = useState<number | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);

    const columns = useMemo<TableColumn<Alert>[]>(() => {
        return [
            ...alertColumns,
            {
                key: "resolved_at",
                displayText: canWrite ? "Aktion" : "Status",
                render: (value, { row }) => {
                    if (value) {
                        return (
                            <span className={styles.actionCell}>
                                {formatTimestamp(value)}
                            </span>
                        );
                    }

                    if (!canWrite) {
                        return (
                            <span className={styles.actionCell}>Offen</span>
                        );
                    }

                    const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
                        event.stopPropagation();
                        void (async () => {
                            setResolvingId(row.id);
                            setActionError(null);
                            try {
                                await resolveAlert(row.id);
                                refetchLists();
                            } catch (caught) {
                                setActionError(
                                    caught instanceof ApiError
                                        ? caught.message
                                        : "Warnung konnte nicht erledigt werden.",
                                );
                            } finally {
                                setResolvingId(null);
                            }
                        })();
                    };

                    return (
                        <span className={styles.actionCell}>
                            <Button
                                variant="secondary"
                                size="sm"
                                disabled={resolvingId === row.id}
                                onClick={handleClick}
                            >
                                Erledigen
                            </Button>
                        </span>
                    );
                },
            },
        ];
    }, [canWrite, refetchLists, resolvingId]);

    const isPageOutOfRange =
        !isLoading && data.length === 0 && total > 0 && tableState.page > pageCount;

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
            className={
                isFetching && !isLoading
                    ? `${styles.alertTable} ${styles.isFetching}`
                    : styles.alertTable
            }
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
                        filters={typeFiltersWithCounts}
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
                emptyContent={
                    isPageOutOfRange ? (
                        <div className={styles.outOfRange}>
                            <p>
                                Seite {tableState.page} gibt es nicht. Es gibt{" "}
                                {pageCount}{" "}
                                {pageCount === 1 ? "Seite." : "Seiten."}
                            </p>
                            <div className={styles.outOfRangeActions}>
                                <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={() => setPage(pageCount)}
                                >
                                    Zur letzten Seite
                                </Button>
                                {pageCount > 1 && (
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => setPage(1)}
                                    >
                                        Zur ersten Seite
                                    </Button>
                                )}
                            </div>
                        </div>
                    ) : query.filter === "open" &&
                      query.type === undefined &&
                      query.vehicle_id === undefined &&
                      query.driver_id === undefined ? (
                        "Keine offenen Warnungen."
                    ) : (
                        "Keine Warnungen passen zum Filter."
                    )
                }
            />

            {total > 0 && tableState.page <= pageCount && (
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
