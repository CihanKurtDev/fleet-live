import type { Site, SiteInput, SiteListResponse, SitePatch } from "@fleet-live/shared";
import { request } from "./client";

export function listSites(signal?: AbortSignal) {
    return request<SiteListResponse>("/api/sites", { signal });
}

export function createSite(input: SiteInput) {
    return request<Site>("/api/sites", { method: "POST", body: input });
}

export function updateSite(id: number, input: SitePatch) {
    return request<Site>(`/api/sites/${id}`, { method: "PATCH", body: input });
}

export function deleteSite(id: number) {
    return request<void>(`/api/sites/${id}`, { method: "DELETE" });
}
