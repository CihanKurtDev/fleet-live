import type { Driver } from "@fleet-live/shared";

import { Table } from "../ui/Table/Table";
import { TableToolbar } from "../ui/Table/TableToolbar";
import { TablePagination } from "../ui/Table/TablePagination";
import { Button } from "../ui/Button/Button";
import { useTable } from "../../hooks/useTable";
import { useDriverList } from "../../hooks/useDriverList";
import { useDriverListQuery } from "../../hooks/useDriverListQuery";
import { driverColumns } from "./driverTableConfig";
import styles from "./DriverTable.module.scss";

interface DriverTableProps {
    onSelectDriver?: (driver: Driver) => void;
}

export const DriverTable = ({ onSelectDriver }: DriverTableProps) => {
    const { apiQuery, tableState, setSearch, handleSort, setPage, setLimit } =
        useDriverListQuery();
    const { data, isLoading, isFetching, error, pageCount, total } =
        useDriverList(apiQuery);

    const { paginatedRows } = useTable({
        rows: data,
        pageCount,
        total,
        tableState,
        setSearch,
        setFilter: () => undefined,
        handleSort,
        setPage,
        setLimit,
    });

    const isPageOutOfRange =
        !isLoading &&
        data.length === 0 &&
        total > 0 &&
        tableState.page > pageCount;

    return (
        <section
            className={
                isFetching && !isLoading
                    ? `${styles.driverTable} ${styles.isFetching}`
                    : styles.driverTable
            }
        >
            <h1 className={styles.title}>Fahrer</h1>
            <p className={styles.lead}>
                Offene Warnungen sind die Inbox; Verstöße die Historie.
            </p>

            <TableToolbar
                search={tableState.search}
                onSearchChange={setSearch}
                searchPlaceholder="Fahrer suchen..."
            />

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
                columns={driverColumns}
                rows={paginatedRows}
                getRowKey={(driver) => driver.id}
                onRowClick={onSelectDriver}
                sortConfig={tableState.sortConfig}
                onSort={handleSort}
                caption="Fahrerliste"
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
                    ) : tableState.search
                      ? "Keine Fahrer passen zur Suche."
                      : "Keine Fahrer."
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
