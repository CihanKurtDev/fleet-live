import type {
    GeocodeConfigResponse,
    GeocodeResponse,
    Vehicle,
    VehicleWorkshopResponse,
    WorkshopCreateInput,
    WorkshopPatch,
    WorkshopPlace,
    WorkshopPlaceInput,
    WorkshopPlacePatch,
    WorkshopBringersResponse,
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

/** Who may bring the vehicle on that day, with an expired licence or another trip spelled out. */
export function getWorkshopBringers(vehicleId: number, on: string, signal?: AbortSignal) {
    return request<WorkshopBringersResponse>(
        `/api/vehicles/${vehicleId}/workshop/bringers?on=${encodeURIComponent(on)}`,
        { signal },
    );
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
        /** „Kilometerstand laut Rechnung“, only for a GPS box. */
        odometer?: string;
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
    return request<{ data: WorkshopPlace[] }>("/api/workshop/places", { signal });
}

export function createWorkshopPlace(input: WorkshopPlaceInput) {
    return request<{ data: WorkshopPlace }>("/api/workshop/places", {
        method: "POST",
        body: input,
    });
}

export function updateWorkshopPlace(placeId: number, patch: WorkshopPlacePatch) {
    return request<{ data: WorkshopPlace }>(`/api/workshop/places/${placeId}`, {
        method: "PATCH",
        body: patch,
    });
}

/** Whether the address search is set up on this server. */
export function getGeocodeConfig(signal?: AbortSignal) {
    return request<GeocodeConfigResponse>("/api/workshop/geocode/config", { signal });
}

/** One search, when the dispatcher presses „Suchen“ (never while typing). */
export function searchAddress(query: string) {
    return request<GeocodeResponse>(`/api/workshop/geocode?q=${encodeURIComponent(query)}`, {
        timeoutMs: 15_000,
    });
}

export function deleteWorkshopPlace(placeId: number) {
    return request<void>(`/api/workshop/places/${placeId}`, { method: "DELETE" });
}

/** The invoice came after the stay. */
export function addWorkshopCost(visitId: number, cost: string) {
    return request<{ data: WorkshopVisit }>(`/api/workshop/${visitId}/cost`, {
        method: "POST",
        body: { cost },
    });
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
    /** Last position, to put the nearest workshops first. */
    position?: { latitude: number; longitude: number } | null;
    /** Current driver, the default for „Bringt hin“. */
    currentDriverId?: number | null;
    /** A damage to tick, e.g. from „Melden und Termin planen“. */
    damageId?: number;
    /** It already parks at this workshop without a stay: enter the stay, no appointment. */
    standingAt?: { id: number; name: string };
};
