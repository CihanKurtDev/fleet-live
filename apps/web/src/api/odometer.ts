import type { OdometerCorrectionInput, VehicleOdometer } from "@fleet-live/shared";

import { request } from "./client";

export function getVehicleOdometer(vehicleId: number, signal?: AbortSignal) {
    return request<{ data: VehicleOdometer }>(`/api/vehicles/${vehicleId}/odometer`, { signal });
}

export function correctVehicleOdometer(vehicleId: number, input: OdometerCorrectionInput) {
    return request<{ data: VehicleOdometer }>(`/api/vehicles/${vehicleId}/odometer`, {
        method: "POST",
        body: input,
    });
}
