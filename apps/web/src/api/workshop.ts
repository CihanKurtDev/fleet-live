import type {
    Vehicle,
    VehicleWorkshopResponse,
    WorkshopCreateInput,
    WorkshopPatch,
    WorkshopReason,
    WorkshopVisit,
} from "@fleet-live/shared";

import { request } from "./client";

export function getVehicleWorkshop(vehicleId: number, signal?: AbortSignal) {
    return request<VehicleWorkshopResponse>(`/api/vehicles/${vehicleId}/workshop`, {
        signal,
    });
}

export function createWorkshopVisit(vehicleId: number, input: WorkshopCreateInput) {
    return request<{ data: WorkshopVisit }>(`/api/vehicles/${vehicleId}/workshop`, {
        method: "POST",
        body: input,
    });
}

export function updateWorkshopVisit(visitId: number, patch: WorkshopPatch) {
    return request<{ data: WorkshopVisit }>(`/api/workshop/${visitId}`, {
        method: "PATCH",
        body: patch,
    });
}

export function arriveWorkshopVisit(visitId: number) {
    return request<{ data: WorkshopVisit }>(`/api/workshop/${visitId}/arrive`, {
        method: "POST",
    });
}

export function finishWorkshopVisit(
    visitId: number,
    input: {
        finished_on: string;
        cost: string;
        result_note: string;
        hu_due_on: string | null;
    },
) {
    return request<{ data: WorkshopVisit }>(`/api/workshop/${visitId}/finish`, {
        method: "POST",
        body: input,
    });
}

export function cancelWorkshopVisit(visitId: number) {
    return request<{ data: WorkshopVisit }>(`/api/workshop/${visitId}/cancel`, {
        method: "POST",
    });
}

export function getWorkshopPlaces(signal?: AbortSignal) {
    return request<{ data: string[] }>("/api/workshop/places", { signal });
}

export function setVehicleOutOfService(vehicleId: number, outOfService: boolean) {
    return request<{ data: Vehicle }>(`/api/vehicles/${vehicleId}/availability`, {
        method: "PATCH",
        body: { out_of_service: outOfService },
    });
}

/** What the plan dialog needs to know about the vehicle it plans for. */
export type WorkshopTarget = {
    vehicleId: number;
    licensePlate: string;
    /** Preselected reason, e.g. HU from an HU row of /fristen. */
    reason?: WorkshopReason;
    /** One line under the title: „HU fällig seit 02.2026“. */
    context?: string;
};
