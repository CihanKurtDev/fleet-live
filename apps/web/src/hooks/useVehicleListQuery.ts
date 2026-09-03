import type { Vehicle } from "@fleet-live/shared";
import {
    isVehicleFilterId,
    isVehicleSortKey,
    serializeVehicleListQuery,
    vehicleListQuerySchema,
    type VehicleListQuery,
} from "@fleet-live/shared";
import {
    createListQueryHook,
    toListQuerySchema,
    type ListQueryPatch,
} from "./createListQueryHook";

const readVehicleParams = (
    searchParams: URLSearchParams,
): Record<string, string | undefined> => ({
    search: searchParams.get("search") ?? "",
    filter: searchParams.get("filter") ?? undefined,
    sort: searchParams.get("sort") ?? undefined,
    dir: searchParams.get("dir") ?? undefined,
    page: searchParams.get("page") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
});

const useVehicleListQueryBase = createListQueryHook<
    Vehicle,
    VehicleListQuery,
    { setFilter: (filterId: string | null) => void }
>({
    schema: toListQuerySchema(vehicleListQuerySchema),
    isSortKey: isVehicleSortKey,
    serialize: serializeVehicleListQuery,
    readParams: readVehicleParams,
    fields: ["search", "filter", "sort", "dir", "page", "limit"],
    debounceSearch: true,
    getFilterId: (query) => query.filter ?? null,
    extra: (patch) => ({
        setFilter: (filterId: string | null) => {
            patch(
                {
                    filter: isVehicleFilterId(filterId) ? filterId : null,
                } as ListQueryPatch<VehicleListQuery>,
                { replace: true, resetPage: true },
            );
        },
    }),
});

export const useVehicleListQuery = () => {
    const {
        query,
        apiQuery,
        tableState,
        sortConfig,
        setSearch,
        setFilter,
        handleSort,
        setPage,
        setLimit,
    } = useVehicleListQueryBase();

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
