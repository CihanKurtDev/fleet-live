import type { SimState } from "@fleet-live/shared";
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
