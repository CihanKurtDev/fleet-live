export type {
    Vehicle,
    VehicleFieldErrors,
    VehicleInput,
    VehicleStatus,
} from "./models/vehicle";

export {
    DRIVER_NAME_MAX,
    FUEL_LEVEL_MAX,
    FUEL_LEVEL_MIN,
    LICENSE_PLATE_MAX,
    VEHICLE_STATUSES,
    isVehicleStatus,
    validateVehicleInput,
    vehicleInputSchema,
} from "./models/vehicle";

export type {
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

export type {
    TelemetryHistoryLimit,
    TelemetryHistoryQuery,
    TelemetryHistoryResponse,
    TelemetryPatch,
    TelemetryPoint,
} from "./models/telemetry";

export {
    TELEMETRY_HISTORY_LIMITS,
    parseTelemetryHistoryQuery,
    telemetryHistoryQuerySchema,
} from "./models/telemetry";

export type { Trip, TripResponse } from "./models/trip";

export type { GeoPoint } from "./geo/polyline";

export {
    decodePolyline,
    encodePoint,
    encodePoints,
    encodePolyline,
} from "./geo/polyline";

export type { StreamFocusInput } from "./models/stream";

export {
    STREAM_FOCUS_MAX_IDS,
    parseStreamFocus,
    streamFocusSchema,
} from "./models/stream";

export type { SimPatch, SimState } from "./models/sim";

export { parseSimPatch, simPatchSchema } from "./models/sim";
