import type { Driver } from "@fleet-live/shared";
import {
    DRIVER_TALK_MIN_OPEN_WARNINGS,
    driverListQuerySchema,
    isDriverSortKey,
    serializeDriverListQuery,
    type DriverListQuery,
} from "@fleet-live/shared";
import {
    createListQueryHook,
    toListQuerySchema,
    type ListQueryPatch,
} from "./createListQueryHook";

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

/** The tiles on `/drivers`: the main filter, exactly one is pressed. */
export type DriverTileId = "all" | "talk" | "without_vehicle";

/** Tile of the current query; `null` for a hand-edited warning minimum. */
export const driverTileOf = (query: DriverListQuery): DriverTileId | null => {
    if (query.without_vehicle) {
        return query.min_open_warnings === undefined ? "without_vehicle" : null;
    }

    if (query.min_open_warnings === undefined) {
        return "all";
    }

    return query.min_open_warnings === DRIVER_TALK_MIN_OPEN_WARNINGS
        ? "talk"
        : null;
};

const useDriverListQueryBase = createListQueryHook<
    Driver,
    DriverListQuery,
    {
        setTile: (tile: DriverTileId) => void;
        clearFilters: () => void;
    }
>({
    schema: toListQuerySchema(driverListQuerySchema),
    isSortKey: isDriverSortKey,
    serialize: serializeDriverListQuery,
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
    extra: (patch) => ({
        setTile: (tile: DriverTileId) => {
            patch(
                {
                    min_open_warnings:
                        tile === "talk" ? DRIVER_TALK_MIN_OPEN_WARNINGS : null,
                    without_vehicle: tile === "without_vehicle" ? true : null,
                } as ListQueryPatch<DriverListQuery>,
                { replace: true, resetPage: true },
            );
        },
        /** "Filter aufheben": tile and search in one URL change. */
        clearFilters: () => {
            patch(
                {
                    min_open_warnings: null,
                    without_vehicle: null,
                    search: "",
                } as ListQueryPatch<DriverListQuery>,
                { replace: true, resetPage: true },
            );
        },
    }),
});

export const useDriverListQuery = () => {
    const {
        query,
        apiQuery,
        tableState,
        setSearch,
        setTile,
        clearFilters,
        handleSort,
        setPage,
        setLimit,
    } = useDriverListQueryBase();

    return {
        query,
        apiQuery,
        tableState,
        setSearch,
        setTile,
        clearFilters,
        handleSort,
        setPage,
        setLimit,
    };
};
