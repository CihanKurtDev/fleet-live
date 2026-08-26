import { useMemo } from "react";
import type {
    TableFilter,
    TableFilterWithCount,
    TableStateProps,
} from "../types/table";

interface UseTableOptions<RowType> {
    rows: RowType[];
    filters?: TableFilter<RowType>[];
    counts?: Partial<Record<string, number>>;
    pageCount: number;
    total: number;
    tableState: TableStateProps<RowType>;
    setSearch: (search: string) => void;
    setFilter: (filterId: string | null) => void;
    handleSort: (key: keyof RowType) => void;
    setPage: (page: number) => void;
    setLimit: (limit: number) => void;
}

/**
 * Server-driven Table-State.
 *
 * Suche, Filter, Sortierung und Pagination passieren in der API.
 * Dieser Hook mappt nur noch Meta/Counts auf die bestehende UI-Signatur.
 */
export const useTable = <RowType,>({
    rows,
    filters,
    counts,
    pageCount,
    total,
    tableState,
    setSearch,
    setFilter,
    handleSort,
    setPage,
    setLimit,
}: UseTableOptions<RowType>) => {
    const filtersWithCounts = useMemo<
        TableFilterWithCount<RowType>[]
    >(
        () =>
            (filters ?? []).map((filter) => ({
                ...filter,
                count: counts?.[filter.id] ?? 0,
            })),
        [filters, counts],
    );

    return {
        tableState,
        setSearch,
        setFilter,
        handleSort,
        setPage,
        setLimit,
        filtersWithCounts,
        filteredRows: rows,
        paginatedRows: rows,
        pageCount,
        total,
    };
};
