import { useCallback, useMemo, useState } from "react";
import type {
    SortConfig,
    TableColumn,
    TableFilter,
    TableFilterWithCount,
    TableStateProps,
} from "../types/table";
import { sortRows } from "../utils/sortRows";
import { useDebouncedValue } from "./useDebouncedValue";

interface UseTableOptions<RowType> {
    rows: RowType[];
    columns: TableColumn<RowType>[];

    /**
     * Felder, die von der Suche durchsucht werden.
     * Ohne Angabe ist die Suche wirkungslos.
     */
    searchKeys?: Array<keyof RowType>;

    filters?: TableFilter<RowType>[];

    initialLimit?: number;
}

export const useTable = <RowType,>({
    rows,
    columns,
    searchKeys,
    filters,
    initialLimit = 10,
}: UseTableOptions<RowType>) => {
    const [search, setSearchValue] = useState("");
    const [filterId, setFilterId] = useState<string | null>(
        null,
    );
    const [sortConfig, setSortConfig] =
        useState<SortConfig<RowType>>(null);
    const [page, setPageValue] = useState(1);
    const [limit, setLimitValue] = useState(initialLimit);

    const debouncedSearch = useDebouncedValue(search);

    const filterList = useMemo(
        () => filters ?? [],
        [filters],
    );

    // 1. Suche
    const searchedRows = useMemo(() => {
        const needle = debouncedSearch.trim().toLowerCase();

        if (!needle || !searchKeys?.length) {
            return rows;
        }

        return rows.filter((row) =>
            searchKeys.some((key) =>
                String(row[key] ?? "")
                    .toLowerCase()
                    .includes(needle),
            ),
        );
    }, [rows, searchKeys, debouncedSearch]);

    // 2. Filter-Counts beziehen sich auf das Suchergebnis,
    //    aber nicht auf den gerade aktiven Filter.
    const filtersWithCounts = useMemo<
        TableFilterWithCount<RowType>[]
    >(() => {
        return filterList.map((filter) => ({
            ...filter,
            count: filter.customSearchFunc
                ? searchedRows.filter(filter.customSearchFunc)
                      .length
                : searchedRows.length,
        }));
    }, [filterList, searchedRows]);

    // 3. Aktiver Filter
    const filteredRows = useMemo(() => {
        const activeFilter = filterList.find(
            (filter) => filter.id === filterId,
        );

        if (!activeFilter?.customSearchFunc) {
            return searchedRows;
        }

        return searchedRows.filter(
            activeFilter.customSearchFunc,
        );
    }, [filterList, filterId, searchedRows]);

    // 4. Sortierung
    const sortedRows = useMemo(() => {
        return sortRows(filteredRows, columns, sortConfig);
    }, [filteredRows, columns, sortConfig]);

    const pageCount = Math.max(
        1,
        Math.ceil(sortedRows.length / limit),
    );

    // Nach dem Filtern kann die aktuelle Seite hinter dem Ende liegen.
    const safePage = Math.min(page, pageCount);

    // 5. Pagination
    const paginatedRows = useMemo(() => {
        const start = (safePage - 1) * limit;

        return sortedRows.slice(start, start + limit);
    }, [sortedRows, safePage, limit]);

    const setSearch = useCallback((newSearch: string) => {
        setSearchValue(newSearch);
        setPageValue(1);
    }, []);

    const setFilter = useCallback(
        (newFilterId: string | null) => {
            setFilterId(newFilterId);
            setPageValue(1);
        },
        [],
    );

    const setLimit = useCallback((newLimit: number) => {
        setLimitValue(newLimit);
        setPageValue(1);
    }, []);

    const setPage = useCallback((newPage: number) => {
        setPageValue(Math.max(1, newPage));
    }, []);

    const handleSort = useCallback(
        (key: keyof RowType) => {
            setSortConfig((current) => {
                // Andere Spalte oder bisher keine Sortierung:
                // → erste Sortierung aufsteigend
                if (!current || current.key !== key) {
                    return {
                        key,
                        direction: "asc",
                    };
                }

                // Asc → Desc
                if (current.direction === "asc") {
                    return {
                        key,
                        direction: "desc",
                    };
                }

                // Desc → kein Sort → ursprüngliche Reihenfolge
                return null;
            });
        },
        [],
    );

    const tableState: TableStateProps<RowType> = {
        search,
        filterId,
        sortConfig,
        page: safePage,
        limit,
    };

    return {
        tableState,

        setSearch,
        setFilter,
        handleSort,
        setPage,
        setLimit,

        filtersWithCounts,

        /** Alle Zeilen nach Suche, Filter und Sortierung. */
        filteredRows: sortedRows,

        /** Die Zeilen der aktuellen Seite. */
        paginatedRows,

        pageCount,
    };
};
