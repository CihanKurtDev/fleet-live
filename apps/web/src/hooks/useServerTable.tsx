import { useMemo, type ReactNode } from "react";
import { TablePageOutOfRange } from "../components/table/TablePageOutOfRange";
import { useTable } from "./useTable";
import type {
    TableFilter,
    TableFilterWithCount,
    TableStateProps,
} from "../types/table";

export type ServerListResult<RowType> = {
    data: RowType[];
    isLoading: boolean;
    isFetching: boolean;
    error: string | null;
    pageCount: number;
    total: number;
};

export type ServerTableQuery<RowType> = {
    tableState: TableStateProps<RowType>;
    setSearch?: (search: string) => void;
    setFilter?: (filterId: string | null) => void;
    handleSort: (key: keyof RowType) => void;
    setPage: (page: number) => void;
    setLimit: (limit: number) => void;
};

type ServerTableExtras<RowType> = {
    filters?: TableFilter<RowType>[];
    counts?: Partial<Record<string, number>>;
};

type UseServerTableOptions<RowType> = {
    listQuery: ServerTableQuery<RowType>;
    listResult: ServerListResult<RowType>;
    filters?: TableFilter<RowType>[];
    counts?: Partial<Record<string, number>>;
    extras?: ServerTableExtras<RowType>;
};

const noop = () => undefined;

export const useServerTable = <RowType,>({
    listQuery,
    listResult,
    filters,
    counts,
    extras,
}: UseServerTableOptions<RowType>) => {
    const setSearch = listQuery.setSearch ?? noop;
    const setFilter = listQuery.setFilter ?? noop;
    const { tableState, handleSort, setPage, setLimit } = listQuery;
    const { data, isLoading, isFetching, error, pageCount, total } =
        listResult;

    const table = useTable({
        rows: data,
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
    });

    const extraFilters = extras?.filters;
    const extraCounts = extras?.counts;

    const extraFiltersWithCounts = useMemo<
        TableFilterWithCount<RowType>[]
    >(
        () =>
            (extraFilters ?? []).map((filter) => ({
                ...filter,
                count: extraCounts?.[filter.id] ?? 0,
            })),
        [extraFilters, extraCounts],
    );

    const isPageOutOfRange =
        !isLoading &&
        data.length === 0 &&
        total > 0 &&
        tableState.page > pageCount;

    const showPagination = total > 0 && tableState.page <= pageCount;
    const isRefreshing = isFetching && !isLoading;

    const sectionClassName = (base: string, fetchingClass: string) =>
        isRefreshing ? `${base} ${fetchingClass}` : base;

    const emptyContent = (fallback: ReactNode): ReactNode =>
        isPageOutOfRange ? (
            <TablePageOutOfRange
                page={tableState.page}
                pageCount={pageCount}
                onGoToLast={() => setPage(pageCount)}
                onGoToFirst={() => setPage(1)}
            />
        ) : (
            fallback
        );

    return {
        ...table,
        data,
        isLoading,
        isFetching,
        error,
        pageCount,
        total,
        isPageOutOfRange,
        showPagination,
        isRefreshing,
        extraFiltersWithCounts,
        sectionClassName,
        emptyContent,
        setSearch,
        setFilter,
        handleSort,
        setPage,
        setLimit,
        tableState,
    };
};
