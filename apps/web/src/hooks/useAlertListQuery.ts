import type { Alert } from "@fleet-live/shared";
import {
    alertListQuerySchema,
    isAlertFilterId,
    isAlertSortKey,
    isAlertType,
    serializeAlertListQuery,
    type AlertListQuery,
} from "@fleet-live/shared";
import {
    createListQueryHook,
    toListQuerySchema,
    type ListQueryPatch,
} from "./createListQueryHook";

const readAlertParams = (
    searchParams: URLSearchParams,
): Record<string, string | undefined> => ({
    filter: searchParams.get("filter") ?? undefined,
    sort: searchParams.get("sort") ?? undefined,
    dir: searchParams.get("dir") ?? undefined,
    page: searchParams.get("page") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
    vehicle_id: searchParams.get("vehicle_id") ?? undefined,
    driver_id: searchParams.get("driver_id") ?? undefined,
    type: searchParams.get("type") ?? undefined,
});

const useAlertListQueryBase = createListQueryHook<
    Alert,
    AlertListQuery,
    {
        setFilter: (filterId: string | null) => void;
        setType: (typeId: string | null) => void;
        clearVehicle: () => void;
        clearDriver: () => void;
    }
>({
    schema: toListQuerySchema(alertListQuerySchema),
    isSortKey: isAlertSortKey,
    serialize: serializeAlertListQuery,
    readParams: readAlertParams,
    fields: [
        "filter",
        "sort",
        "dir",
        "page",
        "limit",
        "vehicle_id",
        "driver_id",
        "type",
    ],
    defaultSort: { key: "created_at", dir: "desc", mode: "sticky" },
    getSearch: () => "",
    getFilterId: (query) => (query.filter === "all" ? null : query.filter),
    extra: (patch) => ({
        setFilter: (filterId: string | null) => {
            patch(
                {
                    filter: isAlertFilterId(filterId) ? filterId : "all",
                } as ListQueryPatch<AlertListQuery>,
                { replace: true, resetPage: true },
            );
        },
        setType: (typeId: string | null) => {
            patch(
                {
                    type: isAlertType(typeId) ? typeId : null,
                } as ListQueryPatch<AlertListQuery>,
                { replace: true, resetPage: true },
            );
        },
        clearVehicle: () => {
            patch(
                { vehicle_id: null } as ListQueryPatch<AlertListQuery>,
                { replace: true, resetPage: true },
            );
        },
        clearDriver: () => {
            patch(
                { driver_id: null } as ListQueryPatch<AlertListQuery>,
                { replace: true, resetPage: true },
            );
        },
    }),
});

export const useAlertListQuery = () => {
    const {
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
    } = useAlertListQueryBase();

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
