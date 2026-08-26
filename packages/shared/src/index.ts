export type {
    Vehicle,
    VehicleFieldErrors,
    VehicleInput,
    VehicleStatus,
} from "./models/vehicle";

export {
    FUEL_LEVEL_MAX,
    FUEL_LEVEL_MIN,
    VEHICLE_STATUSES,
    isVehicleStatus,
    validateVehicleInput,
} from "./models/vehicle";

export type {
    TelemetryPatch,
    VehicleFilterId,
    VehicleListCounts,
    VehicleListMeta,
    VehicleListQuery,
    VehicleListResponse,
    VehiclePageLimit,
    VehicleSortKey,
} from "./models/vehicleQuery";

export {
    VEHICLE_FILTERS,
    VEHICLE_PAGE_LIMITS,
    VEHICLE_SORT_KEYS,
    isVehicleFilterId,
    isVehicleSortKey,
    parseVehicleListQuery,
    serializeVehicleListQuery,
    vehicleListQuerySchema,
} from "./models/vehicleQuery";
