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
    min_open_warnings: searchParams.get("min_open_warnings") ?? undefined,
    without_vehicle: searchParams.get("without_vehicle") ?? undefined,
});

/** `/drivers` shows the board; this param switches to the table. */
export const DRIVER_VIEW_PARAM = "ansicht";
export const DRIVER_LIST_VIEW = "liste";

/**
 * The table lives at `/drivers?ansicht=liste`. The hook rewrites the URL to
 * its canonical form, so the view param is part of that form.
 */
const serializeDriverTableQuery = (query: DriverListQuery) => {
    const params = serializeDriverListQuery(query);
    params.set(DRIVER_VIEW_PARAM, DRIVER_LIST_VIEW);
    return params;
};

const useDriverListQueryBase = createListQueryHook<Driver, DriverListQuery>({
    schema: toListQuerySchema(driverListQuerySchema),
    isSortKey: isDriverSortKey,
    serialize: serializeDriverTableQuery,
    readParams: readDriverParams,
    fields: [
        "search",
        "page",
        "limit",
        "sort",
        "dir",
        "min_open_warnings",
        "without_vehicle",
    ],
    defaultSort: { key: "open_warnings", dir: "desc", mode: "implied" },
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
