import type {
    TripResponse,
    Vehicle,
    VehicleInput,
    VehicleListQuery,
    VehicleListResponse,
} from "@fleet-live/shared";
import { serializeVehicleListQuery } from "@fleet-live/shared";
import { request } from "./client";

export function listVehicles(
    query: VehicleListQuery,
    signal?: AbortSignal,
) {
    const params = serializeVehicleListQuery(query);
    const suffix = params.toString();

    return request<VehicleListResponse>(
        `/api/vehicles${suffix ? `?${suffix}` : ""}`,
        { signal },
    );
}

export function getVehicle(id: number, signal?: AbortSignal) {
    return request<Vehicle>(`/api/vehicles/${id}`, { signal });
}

/** Laufende Fahrt, sonst die letzte beendete — inklusive Streckenverlauf. */
export function getVehicleTrip(id: number, signal?: AbortSignal) {
    return request<TripResponse>(`/api/vehicles/${id}/trips/latest`, {
        signal,
    });
}

export function createVehicle(input: VehicleInput) {
    return request<Vehicle>("/api/vehicles", {
        method: "POST",
        body: input,
    });
}

export function updateVehicle(id: number, input: VehicleInput) {
    return request<Vehicle>(`/api/vehicles/${id}`, {
        method: "PUT",
        body: input,
    });
}

export function patchVehicle(id: number, input: Partial<VehicleInput>) {
    return request<Vehicle>(`/api/vehicles/${id}`, {
        method: "PATCH",
        body: input,
    });
}

export function deleteVehicle(id: number) {
    return request<void>(`/api/vehicles/${id}`, {
        method: "DELETE",
    });
}
