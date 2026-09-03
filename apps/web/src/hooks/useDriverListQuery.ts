import type { Driver } from "@fleet-live/shared";
import {
    driverListQuerySchema,
    isDriverSortKey,
    serializeDriverListQuery,
    type DriverListQuery,
} from "@fleet-live/shared";
import { createListQueryHook, toListQuerySchema } from "./createListQueryHook";

const readDriverParams = (
    searchParams: URLSearchParams,
): Record<string, string | undefined> => ({
    search: searchParams.get("search") ?? "",
    page: searchParams.get("page") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
    sort: searchParams.get("sort") ?? undefined,
    dir: searchParams.get("dir") ?? undefined,
});

const useDriverListQueryBase = createListQueryHook<Driver, DriverListQuery>({
    schema: toListQuerySchema(driverListQuerySchema),
    isSortKey: isDriverSortKey,
    serialize: serializeDriverListQuery,
    readParams: readDriverParams,
    fields: ["search", "page", "limit", "sort", "dir"],
    defaultSort: { key: "name", dir: "asc", mode: "implied" },
    debounceSearch: true,
});

export const useDriverListQuery = () => {
    const {
        query,
        apiQuery,
        tableState,
        setSearch,
        handleSort,
        setPage,
        setLimit,
    } = useDriverListQueryBase();

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
