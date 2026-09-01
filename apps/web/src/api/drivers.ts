import type {
    DriverDetailResponse,
    DriverListQuery,
    DriverListResponse,
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
