import type { SimRouteListResponse, SimState } from "@fleet-live/shared";
import { request } from "./client";

export function getSim(signal?: AbortSignal) {
    return request<SimState>("/api/sim", { signal });
}

export function setSimRunning(running: boolean) {
    return request<SimState>("/api/sim", {
        method: "PATCH",
        body: { running },
    });
}

let routesRequest: Promise<SimRouteListResponse> | null = null;

/** The simulator's roads never change while the app runs: fetched once. */
export function listSimRoutes() {
    routesRequest ??= request<SimRouteListResponse>("/api/sim/routes").catch(
        (error: unknown) => {
            routesRequest = null;
            throw error;
        },
    );

    return routesRequest;
}
