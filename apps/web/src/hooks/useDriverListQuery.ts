import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import type { Driver } from "@fleet-live/shared";
import {
    driverListQuerySchema,
    isDriverSortKey,
    serializeDriverListQuery,
    type DriverListQuery,
} from "@fleet-live/shared";
import type { TableStateProps } from "../types/table";
import { useDebouncedValue } from "./useDebouncedValue";

function parseParams(searchParams: URLSearchParams): DriverListQuery {
    const raw = {
        search: searchParams.get("search") ?? "",
        page: searchParams.get("page") ?? undefined,
        limit: searchParams.get("limit") ?? undefined,
        sort: searchParams.get("sort") ?? undefined,
        dir: searchParams.get("dir") ?? undefined,
    };

    const parsed = driverListQuerySchema.safeParse(raw);
    if (parsed.success) {
        return parsed.data;
    }

    const kept: Record<string, unknown> = {};
    const candidates = [
        driverListQuerySchema.pick({ search: true }).safeParse({
            search: raw.search,
        }),
        driverListQuerySchema.pick({ page: true }).safeParse({
            page: raw.page,
        }),
        driverListQuerySchema.pick({ limit: true }).safeParse({
            limit: raw.limit,
        }),
        driverListQuerySchema.pick({ sort: true }).safeParse({
            sort: raw.sort,
        }),
        driverListQuerySchema.pick({ dir: true }).safeParse({
            dir: raw.dir,
        }),
    ];

    for (const result of candidates) {
        if (result.success) {
            Object.assign(kept, result.data);
        }
    }

    return driverListQuerySchema.parse(kept);
}

type QueryPatch = {
    search?: string;
    page?: number;
    limit?: DriverListQuery["limit"];
    sort?: DriverListQuery["sort"] | null;
    dir?: DriverListQuery["dir"];
};

export const useDriverListQuery = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const query = useMemo(
        () => parseParams(searchParams),
        [searchParams],
    );
    const debouncedSearch = useDebouncedValue(query.search);

    useEffect(() => {
        const canonical = serializeDriverListQuery(query);

        if (searchParams.toString() !== canonical.toString()) {
            setSearchParams(canonical, { replace: true });
        }
    }, [query, searchParams, setSearchParams]);

    const patch = useCallback(
        (
            updates: QueryPatch,
            options: { replace?: boolean; resetPage?: boolean } = {},
        ) => {
            setSearchParams(
                (current) => {
                    const previous = parseParams(current);
                    const next: DriverListQuery = {
                        ...previous,
                        search: updates.search ?? previous.search,
                        page: updates.page ?? previous.page,
                        limit: updates.limit ?? previous.limit,
                        dir: updates.dir ?? previous.dir,
                        sort:
                            updates.sort === null
                                ? undefined
                                : (updates.sort ?? previous.sort),
                        ...(options.resetPage ? { page: 1 } : {}),
                    };

                    return serializeDriverListQuery(next);
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

    const setPage = useCallback(
        (page: number) => {
            patch({ page: Math.max(1, page) });
        },
        [patch],
    );

    const setLimit = useCallback(
        (limit: number) => {
            patch(
                { limit: limit as DriverListQuery["limit"] },
                { replace: true, resetPage: true },
            );
        },
        [patch],
    );

    const handleSort = useCallback(
        (key: keyof Driver) => {
            if (!isDriverSortKey(key)) {
                return;
            }

            patch(
                (() => {
                    const current = query.sort ?? "name";

                    if (current !== key) {
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

    const tableState: TableStateProps<Driver> = {
        search: query.search,
        filterId: null,
        sortConfig: query.sort
            ? {
                  key: query.sort,
                  direction: query.dir,
              }
            : {
                  key: "name",
                  direction: "asc",
              },
        page: query.page,
        limit: query.limit,
    };

    const apiQuery: DriverListQuery = {
        ...query,
        search: debouncedSearch,
    };

    return {
        query,
        apiQuery,
        tableState,
        setSearch,
        handleSort,
        setPage,
        setLimit,
    };
};
