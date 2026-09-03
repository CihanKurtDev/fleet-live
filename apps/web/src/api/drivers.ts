import type {
    DriverCreateInput,
    DriverCurrentVehicleInput,
    DriverDetail,
    DriverDetailResponse,
    DriverListQuery,
    DriverListResponse,
    DriverVehicleAssignInput,
} from "@fleet-live/shared";
import { serializeDriverListQuery } from "@fleet-live/shared";
import { request } from "./client";

export function listDrivers(query: DriverListQuery, signal?: AbortSignal) {
    const params = serializeDriverListQuery(query);
    const suffix = params.toString();

    return request<DriverListResponse>(
        `/api/drivers${suffix ? `?${suffix}` : ""}`,
        { signal },
    );
}

export function getDriver(id: number, signal?: AbortSignal) {
    return request<DriverDetailResponse>(`/api/drivers/${id}`, { signal }).then(
        (response) => response.data,
    );
}

export function createDriver(input: DriverCreateInput) {
    return request<{ data: { id: number; name: string; created_at: string } }>(
        "/api/drivers",
        { method: "POST", body: input },
    ).then((response) => response.data);
}

export function assignDriverVehicle(
    driverId: number,
    input: DriverVehicleAssignInput,
) {
    return request<{ data: DriverDetail }>(`/api/drivers/${driverId}/vehicles`, {
        method: "POST",
        body: input,
    }).then((response) => response.data);
}

export function unassignDriverVehicle(driverId: number, vehicleId: number) {
    return request<{ data: DriverDetail }>(
        `/api/drivers/${driverId}/vehicles/${vehicleId}`,
        { method: "DELETE" },
    ).then((response) => response.data);
}

export function setDriverCurrentVehicle(
    driverId: number,
    input: DriverCurrentVehicleInput,
) {
    return request<{ data: DriverDetail }>(
        `/api/drivers/${driverId}/current-vehicle`,
        { method: "PATCH", body: input },
    ).then((response) => response.data);
}
