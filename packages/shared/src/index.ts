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

export type {
    Alert,
    AlertDetails,
    AlertFilterId,
    AlertListCounts,
    AlertListMeta,
    AlertListQuery,
    AlertListResponse,
    AlertPageLimit,
    AlertPatch,
    AlertSeverity,
    AlertSortKey,
    AlertType,
    AlertTypeCounts,
    LowFuelAlertDetails,
    SpeedingAlertDetails,
} from "./models/alert";

export {
    ALERT_FILTERS,
    ALERT_SEVERITIES,
    ALERT_SORT_KEYS,
    ALERT_TYPES,
    alertListQuerySchema,
    alertPatchSchema,
    formatAlertEvent,
    isAlertFilterId,
    isAlertSeverity,
    isAlertSortKey,
    isAlertType,
    isLowFuelAlertDetails,
    isLowFuelLevel,
    isSpeedingAlertDetails,
    LOW_FUEL_CRITICAL_PERCENT,
    LOW_FUEL_THRESHOLD_PERCENT,
    lowFuelSeverity,
    OFFLINE_AFTER_MS,
    parseAlertListQuery,
    parseAlertPatch,
    serializeAlertListQuery,
} from "./models/alert";

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

export type { AuthUser, LoginInput, UserRole } from "./models/auth";

export { USER_ROLES, parseLoginInput } from "./models/auth";

export type { SimPatch, SimState } from "./models/sim";

export { parseSimPatch, simPatchSchema } from "./models/sim";

export type { SpeedBand, SpeedBandReason, SpeedBandResult } from "./models/speedBand";

export {
    SPEED_BANDS,
    SPEED_BAND_REASONS,
    SPEED_CRITICAL_OVER_LIMIT_KMH,
    SPEEDING_HYSTERESIS_MS,
    SPEEDING_OPEN_AFTER_MS,
    isOverSpeedLimit,
    speedBand,
} from "./models/speedBand";

export {
    DRIVER_INCIDENT_TYPES,
    DRIVER_SORT_KEYS,
    driverListQuerySchema,
    isDriverSortKey,
    parseDriverListQuery,
    serializeDriverListQuery,
} from "./models/driver";

export type {
    Driver,
    DriverDetail,
    DriverDetailResponse,
    DriverIncidentCounts,
    DriverListMeta,
    DriverListQuery,
    DriverListResponse,
    DriverSortKey,
    DriverVehicle,
} from "./models/driver";

export type {
    BriefingCounts,
    BriefingData,
    BriefingDriver,
    BriefingHistoryMonth,
    BriefingOfflineVehicle,
    BriefingResponse,
} from "./models/briefing";

export {
    BRIEFING_DRIVER_LIMIT,
    BRIEFING_HISTORY_MONTHS,
    BRIEFING_OFFLINE_LIMIT,
    BRIEFING_OPEN_ALERT_LIMIT,
    briefingMonthKeys,
} from "./models/briefing";

export type {
    FleetDriver,
    FleetDriversQuery,
    FleetDriversResponse,
    FleetPosition,
    FleetPositionsQuery,
    FleetPositionsResponse,
    GeoBBox,
} from "./models/fleet";

export {
    FLEET_DRIVERS_LIST_LIMIT,
    FLEET_DRIVERS_MAX,
    FLEET_POSITIONS_MAX,
    fleetDriversQuerySchema,
    fleetPositionsQuerySchema,
    parseFleetDriversQuery,
    parseFleetPositionsQuery,
    serializeFleetDriversQuery,
    serializeFleetPositionsQuery,
} from "./models/fleet";
