import type { Driver } from "@fleet-live/shared";

import { Table } from "../ui/Table/Table";
import { TableToolbar } from "../ui/Table/TableToolbar";
import { TablePagination } from "../ui/Table/TablePagination";
import { useServerTable } from "../../hooks/useServerTable";
import { useDriverList } from "../../hooks/useDriverList";
import { useDriverListQuery } from "../../hooks/useDriverListQuery";
import { driverColumns } from "./driverTableConfig";
import styles from "./DriverTable.module.scss";

interface DriverTableProps {
    onSelectDriver?: (driver: Driver) => void;
    onAddDriver?: () => void;
}

export const DriverTable = ({
    onSelectDriver,
    onAddDriver,
}: DriverTableProps) => {
    const listQuery = useDriverListQuery();
    const listResult = useDriverList(listQuery.apiQuery);
    const {
        tableState,
        paginatedRows,
        isLoading,
        error,
        pageCount,
        total,
        showPagination,
        sectionClassName,
        emptyContent,
        setSearch,
        handleSort,
        setPage,
        setLimit,
    } = useServerTable<Driver>({
        listQuery,
        listResult,
    });

    return (
        <section
            className={sectionClassName(styles.driverTable, styles.isFetching)}
        >
            <h1 className={styles.title}>Fahrer</h1>
            <p className={styles.lead}>
                Offene Warnungen sind Tempo-Überschreitungen in der Inbox;
                Verstöße die Historie.
            </p>

            <TableToolbar
                search={tableState.search}
                onSearchChange={setSearch}
                searchPlaceholder="Fahrer suchen..."
                addNewLabel="Fahrer anlegen"
                onAddNew={onAddDriver}
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
                emptyContent={emptyContent(
                    tableState.search
                        ? "Keine Fahrer passen zur Suche."
                        : "Keine Fahrer.",
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
