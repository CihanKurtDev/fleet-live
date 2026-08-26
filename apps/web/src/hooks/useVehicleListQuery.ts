import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import type { Vehicle } from "@fleet-live/shared";
import {
    isVehicleFilterId,
    isVehicleSortKey,
    vehicleListQuerySchema,
    type VehicleListQuery,
} from "@fleet-live/shared";
import type { SortConfig, TableStateProps } from "../types/table";
import { useDebouncedValue } from "./useDebouncedValue";

function parseParams(searchParams: URLSearchParams): VehicleListQuery {
    const parsed = vehicleListQuerySchema.safeParse({
        search: searchParams.get("search") ?? "",
        filter: searchParams.get("filter") ?? undefined,
        sort: searchParams.get("sort") ?? undefined,
        dir: searchParams.get("dir") ?? undefined,
        page: searchParams.get("page") ?? undefined,
        limit: searchParams.get("limit") ?? undefined,
    });

    return parsed.success
        ? parsed.data
        : vehicleListQuerySchema.parse({});
}

function toSearchParams(query: VehicleListQuery): URLSearchParams {
    const params = new URLSearchParams();

    if (query.search) {
        params.set("search", query.search);
    }

    if (query.filter) {
        params.set("filter", query.filter);
    }

    if (query.sort) {
        params.set("sort", query.sort);
        params.set("dir", query.dir);
    }

    if (query.page > 1) {
        params.set("page", String(query.page));
    }

    if (query.limit !== 10) {
        params.set("limit", String(query.limit));
    }

    return params;
}

type QueryPatch = {
    search?: string;
    filter?: VehicleListQuery["filter"] | null;
    sort?: VehicleListQuery["sort"] | null;
    dir?: VehicleListQuery["dir"];
    page?: number;
    limit?: VehicleListQuery["limit"];
};

export const useVehicleListQuery = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const query = useMemo(
        () => parseParams(searchParams),
        [searchParams],
    );
    const debouncedSearch = useDebouncedValue(query.search);

    const patch = useCallback(
        (
            updates: QueryPatch,
            options: { replace?: boolean; resetPage?: boolean } = {},
        ) => {
            setSearchParams(
                (current) => {
                    const previous = parseParams(current);
                    const next: VehicleListQuery = {
                        ...previous,
                        search: updates.search ?? previous.search,
                        dir: updates.dir ?? previous.dir,
                        page: updates.page ?? previous.page,
                        limit: updates.limit ?? previous.limit,
                        sort:
                            updates.sort === null
                                ? undefined
                                : (updates.sort ?? previous.sort),
                        filter:
                            updates.filter === null
                                ? undefined
                                : (updates.filter ?? previous.filter),
                        ...(options.resetPage ? { page: 1 } : {}),
                    };

                    return toSearchParams(next);
                },
                { replace: options.replace ?? false },
            );
        },
        [setSearchParams],
    );

    const setSearch = useCallback(
        (search: string) => {
            patch({ search }, { replace: true, resetPage: true });
        },
        [patch],
    );

    const setFilter = useCallback(
        (filterId: string | null) => {
            patch(
                {
                    filter: isVehicleFilterId(filterId) ? filterId : null,
                },
                { replace: true, resetPage: true },
            );
        },
        [patch],
    );

    const setPage = useCallback(
        (page: number) => {
            patch({ page: Math.max(1, page) });
        },
        [patch],
    );

    const setLimit = useCallback(
        (limit: number) => {
            patch(
                { limit: limit as VehicleListQuery["limit"] },
                { replace: true, resetPage: true },
            );
        },
        [patch],
    );

    const handleSort = useCallback(
        (key: keyof Vehicle) => {
            if (!isVehicleSortKey(key)) {
                return;
            }

            patch(
                (() => {
                    if (!query.sort || query.sort !== key) {
                        return { sort: key, dir: "asc" as const };
                    }

                    if (query.dir === "asc") {
                        return { sort: key, dir: "desc" as const };
                    }

                    return { sort: null, dir: "asc" as const };
                })(),
                { replace: true },
            );
        },
        [patch, query.sort, query.dir],
    );

    const tableState: TableStateProps<Vehicle> = {
        search: query.search,
        filterId: query.filter ?? null,
        sortConfig: query.sort
            ? {
                  key: query.sort,
                  direction: query.dir,
              }
            : null,
        page: query.page,
        limit: query.limit,
    };

    const apiQuery: VehicleListQuery = {
        ...query,
        search: debouncedSearch,
    };

    const sortConfig: SortConfig<Vehicle> = tableState.sortConfig;

    return {
        query,
        apiQuery,
        tableState,
        sortConfig,
        setSearch,
        setFilter,
        handleSort,
        setPage,
        setLimit,
    };
};
