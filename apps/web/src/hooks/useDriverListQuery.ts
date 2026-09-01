import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import type { Driver } from "@fleet-live/shared";
import {
    driverListQuerySchema,
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

    const tableState: TableStateProps<Driver> = {
        search: query.search,
        filterId: null,
        sortConfig: null,
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
        setPage,
        setLimit,
    };
};
