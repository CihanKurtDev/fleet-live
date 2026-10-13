import { useMemo } from "react";
import { DUE_SOON_DAYS, type DueListItem, type DueListState } from "@fleet-live/shared";

import { DueSettingsForm } from "./DueSettingsForm";
import { Input } from "../ui/Input/Input";
import { Table } from "../ui/Table/Table";
import { TablePagination } from "../ui/Table/TablePagination";
import { RetryMessage } from "../ui/RetryMessage";
import { useServerTable } from "../../hooks/useServerTable";
import { useDueList } from "../../hooks/useDueList";
import { useDueListQuery } from "../../hooks/useDueListQuery";
import {
    dueColumns,
    dueKindFilters,
    dueStateFiltersFor,
} from "./dueTableConfig";
import styles from "./DueTable.module.scss";
import band from "../../styles/pageBand.module.scss";

interface DueTableProps {
    onSelectRow?: (row: DueListItem) => void;
}

const emptyLabel = (
    state: DueListState,
    hasSearch: boolean,
    leadDays: number,
    kind: string | undefined,
    checkMonths: number,
): string => {
    if (kind === "licence_check" && checkMonths === 0) {
        return "Führerscheinkontrolle ist aus.";
    }

    if (kind === "licence_check" && !hasSearch) {
        if (state === "soon") {
            return leadDays === 0
                ? "Heute ist keine Kontrolle fällig."
                : `In den nächsten ${leadDays} Tagen ist keine Kontrolle fällig.`;
        }

        if (state === "missing") {
            return "Eine fehlende Kontrolle steht unter Überfällig.";
        }

        return "Keine Kontrolle ist überfällig.";
    }

    if (hasSearch || kind !== undefined) {
        return "Keine Fristen passen zum Filter.";
    }

    if (state === "soon") {
        return leadDays === 0
            ? "Nichts ist heute fällig."
            : `Nichts wird in den nächsten ${leadDays} Tagen fällig.`;
    }

    if (state === "missing") {
        return "Alle Daten sind gesetzt.";
    }

    return "Nichts ist überfällig.";
};

export const DueTable = ({ onSelectRow }: DueTableProps) => {
    const listQuery = useDueListQuery();
    const listResult = useDueList(listQuery.apiQuery);
    const { query, setKind, showOverdueChecks } = listQuery;
    const { meta } = listResult;
    const leadDays = meta?.lead_days ?? DUE_SOON_DAYS;
    const stateFilters = useMemo(
        () => dueStateFiltersFor(leadDays),
        [leadDays],
    );
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
        filters: stateFilters,
        counts: listResult.meta?.counts,
        extras: {
            filters: dueKindFilters,
            counts: listResult.meta?.kind_counts,
        },
    });

    return (
        <section className={sectionClassName(styles.dueTable, styles.isFetching)}>
            <header className={`${band.band} ${band.bleed}`}>
                <div className={styles.heading}>
                    <div>
                        <h1 className={styles.title}>Fristen</h1>
                        <p className={styles.lead}>Eine Zeile ist ein Termin.</p>
                    </div>
                    <Input
                        type="search"
                        size="sm"
                        className={styles.search}
                        placeholder="Kennzeichen oder Fahrer suchen..."
                        aria-label="Kennzeichen oder Fahrer suchen"
                        value={tableState.search}
                        onChange={(event) => setSearch(event.target.value)}
                    />
                </div>

                {!isLoading && (
                    <DueSettingsForm
                        onSaved={listResult.retry}
                        standFilters={filtersWithCounts}
                        activeStand={tableState.filterId}
                        onStand={setFilter}
                        kindFilters={extraFiltersWithCounts}
                        activeKind={query.kind ?? null}
                        onKind={setKind}
                        onShowChecks={showOverdueChecks}
                        allCount={meta?.kind_counts.all}
                        leadDays={leadDays}
                        checkMonths={meta?.licence_check_months ?? 6}
                    />
                )}
            </header>

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
                        query.search.length > 0,
                        leadDays,
                        query.kind,
                        meta?.licence_check_months ?? 6,
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
