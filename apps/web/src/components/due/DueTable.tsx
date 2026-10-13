import type { DueListItem, DueListState } from "@fleet-live/shared";

import { Table } from "../ui/Table/Table";
import { TableFilterBar } from "../ui/Table/TableFilterBar";
import { TablePagination } from "../ui/Table/TablePagination";
import { TableToolbar } from "../ui/Table/TableToolbar";
import { RetryMessage } from "../ui/RetryMessage";
import { useServerTable } from "../../hooks/useServerTable";
import { useDueList } from "../../hooks/useDueList";
import { useDueListQuery } from "../../hooks/useDueListQuery";
import {
    dueColumns,
    dueKindFilters,
    dueStateFilters,
} from "./dueTableConfig";
import styles from "./DueTable.module.scss";

interface DueTableProps {
    onSelectRow?: (row: DueListItem) => void;
}

const emptyLabel = (
    state: DueListState,
    narrowed: boolean,
): string => {
    if (narrowed) {
        return "Keine Fristen passen zum Filter.";
    }

    if (state === "soon") {
        return "Nichts wird in den nächsten 30 Tagen fällig.";
    }

    if (state === "missing") {
        return "Alle Daten sind gesetzt.";
    }

    return "Nichts ist überfällig.";
};

export const DueTable = ({ onSelectRow }: DueTableProps) => {
    const listQuery = useDueListQuery();
    const listResult = useDueList(listQuery.apiQuery);
    const { query, setKind } = listQuery;
    const { meta } = listResult;
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
        setSearch,
        setFilter,
        handleSort,
        setPage,
        setLimit,
    } = useServerTable<DueListItem>({
        listQuery,
        listResult,
        filters: dueStateFilters,
        counts: listResult.meta?.counts,
        extras: {
            filters: dueKindFilters,
            counts: listResult.meta?.kind_counts,
        },
    });

    return (
        <section className={sectionClassName(styles.dueTable, styles.isFetching)}>
            <h1 className={styles.title}>Fristen</h1>
            <p className={styles.lead}>Eine Zeile ist ein Termin.</p>

            <TableToolbar
                search={tableState.search}
                onSearchChange={setSearch}
                searchPlaceholder="Kennzeichen oder Fahrer suchen..."
                searchAriaLabel="Kennzeichen oder Fahrer suchen"
            />

            {!isLoading && (
                <div className={styles.filters}>
                    <TableFilterBar
                        filters={filtersWithCounts}
                        activeFilterId={tableState.filterId}
                        onFilterChange={setFilter}
                        showAll={false}
                        groupLabel="Stand"
                        ariaLabel="Stand"
                    />
                    <TableFilterBar
                        filters={extraFiltersWithCounts}
                        activeFilterId={query.kind ?? null}
                        onFilterChange={setKind}
                        allCount={meta?.kind_counts.all}
                        allLabel="Alle"
                        groupLabel="Art"
                        ariaLabel="Art"
                    />
                </div>
            )}

            {error && (
                <RetryMessage message={error} onRetry={listResult.retry} />
            )}

            {isLoading && (
                <p className={styles.status} aria-live="polite">
                    Tabelle wird geladen…
                </p>
            )}

            <Table
                columns={dueColumns}
                rows={paginatedRows}
                getRowKey={(row) =>
                    `${row.kind}:${row.vehicle_id ?? 0}:${row.driver_id ?? 0}`
                }
                onRowClick={onSelectRow}
                sortConfig={tableState.sortConfig}
                onSort={handleSort}
                caption="Fristenliste"
                isLoading={isLoading}
                skeletonRowCount={Math.min(tableState.limit, 10)}
                emptyContent={emptyContent(
                    emptyLabel(
                        query.state,
                        query.search.length > 0 || query.kind !== undefined,
                    ),
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
        </section>
    );
};
