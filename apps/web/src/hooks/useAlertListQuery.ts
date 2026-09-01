import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import type { Alert } from "@fleet-live/shared";
import {
    alertListQuerySchema,
    isAlertFilterId,
    isAlertSortKey,
    isAlertType,
    serializeAlertListQuery,
    type AlertListQuery,
} from "@fleet-live/shared";
import type { SortConfig, TableStateProps } from "../types/table";

function parseParams(searchParams: URLSearchParams): AlertListQuery {
    const raw = {
        filter: searchParams.get("filter") ?? undefined,
        sort: searchParams.get("sort") ?? undefined,
        dir: searchParams.get("dir") ?? undefined,
        page: searchParams.get("page") ?? undefined,
        limit: searchParams.get("limit") ?? undefined,
        vehicle_id: searchParams.get("vehicle_id") ?? undefined,
        driver_id: searchParams.get("driver_id") ?? undefined,
        type: searchParams.get("type") ?? undefined,
    };

    const parsed = alertListQuerySchema.safeParse(raw);
    if (parsed.success) {
        return parsed.data;
    }

    const kept: Record<string, unknown> = {};
    const candidates = [
        alertListQuerySchema.pick({ filter: true }).safeParse({
            filter: raw.filter,
        }),
        alertListQuerySchema.pick({ sort: true }).safeParse({
            sort: raw.sort,
        }),
        alertListQuerySchema.pick({ dir: true }).safeParse({
            dir: raw.dir,
        }),
        alertListQuerySchema.pick({ page: true }).safeParse({
            page: raw.page,
        }),
        alertListQuerySchema.pick({ limit: true }).safeParse({
            limit: raw.limit,
        }),
        alertListQuerySchema.pick({ vehicle_id: true }).safeParse({
            vehicle_id: raw.vehicle_id,
        }),
        alertListQuerySchema.pick({ driver_id: true }).safeParse({
            driver_id: raw.driver_id,
        }),
        alertListQuerySchema.pick({ type: true }).safeParse({
            type: raw.type,
        }),
    ];

    for (const result of candidates) {
        if (result.success) {
            Object.assign(kept, result.data);
        }
    }

    return alertListQuerySchema.parse(kept);
}

type QueryPatch = {
    filter?: AlertListQuery["filter"];
    sort?: AlertListQuery["sort"];
    dir?: AlertListQuery["dir"];
    page?: number;
    limit?: AlertListQuery["limit"];
    vehicle_id?: number | null;
    driver_id?: number | null;
    type?: AlertListQuery["type"] | null;
};

export const useAlertListQuery = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const query = useMemo(
        () => parseParams(searchParams),
        [searchParams],
    );

    useEffect(() => {
        const canonical = serializeAlertListQuery(query);

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
                    const next: AlertListQuery = {
                        ...previous,
                        filter: updates.filter ?? previous.filter,
                        sort: updates.sort ?? previous.sort,
                        dir: updates.dir ?? previous.dir,
                        page: updates.page ?? previous.page,
                        limit: updates.limit ?? previous.limit,
                        vehicle_id:
                            updates.vehicle_id === null
                                ? undefined
                                : (updates.vehicle_id ?? previous.vehicle_id),
                        driver_id:
                            updates.driver_id === null
                                ? undefined
                                : (updates.driver_id ?? previous.driver_id),
                        type:
                            updates.type === null
                                ? undefined
                                : (updates.type ?? previous.type),
                        ...(options.resetPage ? { page: 1 } : {}),
                    };

                    return serializeAlertListQuery(next);
                },
                { replace: options.replace ?? false },
            );
        },
        [setSearchParams],
    );

    const setFilter = useCallback(
        (filterId: string | null) => {
            patch(
                {
                    filter: isAlertFilterId(filterId) ? filterId : "all",
                },
                { replace: true, resetPage: true },
            );
        },
        [patch],
    );

    const setType = useCallback(
        (typeId: string | null) => {
            patch(
                {
                    type: isAlertType(typeId) ? typeId : null,
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
                { limit: limit as AlertListQuery["limit"] },
                { replace: true, resetPage: true },
            );
        },
        [patch],
    );

    const clearVehicle = useCallback(() => {
        patch({ vehicle_id: null }, { replace: true, resetPage: true });
    }, [patch]);

    const clearDriver = useCallback(() => {
        patch({ driver_id: null }, { replace: true, resetPage: true });
    }, [patch]);

    const handleSort = useCallback(
        (key: keyof Alert) => {
            if (!isAlertSortKey(key)) {
                return;
            }

            patch(
                (() => {
                    if (query.sort !== key) {
                        return {
                            sort: key,
                            dir: key === "created_at" ? ("desc" as const) : ("asc" as const),
                        };
                    }

                    if (key === "created_at") {
                        return {
                            sort: "created_at" as const,
                            dir:
                                query.dir === "desc"
                                    ? ("asc" as const)
                                    : ("desc" as const),
                        };
                    }

                    if (query.dir === "asc") {
                        return { sort: key, dir: "desc" as const };
                    }

                    return { sort: "created_at" as const, dir: "desc" as const };
                })(),
                { replace: true },
            );
        },
        [patch, query.sort, query.dir],
    );

    const tableState: TableStateProps<Alert> = {
        search: "",
        filterId: query.filter === "all" ? null : query.filter,
        sortConfig: {
            key: query.sort,
            direction: query.dir,
        },
        page: query.page,
        limit: query.limit,
    };

    const sortConfig: SortConfig<Alert> = tableState.sortConfig;

    return {
        query,
        tableState,
        sortConfig,
        setFilter,
        setType,
        handleSort,
        setPage,
        setLimit,
        clearVehicle,
        clearDriver,
    };
};
