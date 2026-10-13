import type {
    DueListQuery,
    DueListResponse,
    DueSettings,
} from "@fleet-live/shared";
import { serializeDueListQuery } from "@fleet-live/shared";
import { request } from "./client";

export function listDue(query: DueListQuery, signal?: AbortSignal) {
    const params = serializeDueListQuery(query);
    const suffix = params.toString();

    return request<DueListResponse>(`/api/due${suffix ? `?${suffix}` : ""}`, {
        signal,
    });
}

export function getDueSettings(signal?: AbortSignal) {
    return request<{ data: DueSettings }>("/api/due/settings", { signal });
}

export function updateDueSettings(body: {
    due_lead_days?: number | null;
    licence_check_months?: number | null;
}) {
    return request<{ data: DueSettings }>("/api/due/settings", {
        method: "PATCH",
        body,
    });
}
