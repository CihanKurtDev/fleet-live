import type {
    Alert,
    AlertListQuery,
    AlertListResponse,
    AlertPatch,
} from "@fleet-live/shared";
import { serializeAlertListQuery } from "@fleet-live/shared";
import { request } from "./client";

export function listAlerts(query: AlertListQuery, signal?: AbortSignal) {
    const params = serializeAlertListQuery(query);
    const suffix = params.toString();

    return request<AlertListResponse>(
        `/api/alerts${suffix ? `?${suffix}` : ""}`,
        { signal },
    );
}

export function resolveAlert(id: number, body: AlertPatch = { resolved: true }) {
    return request<Alert>(`/api/alerts/${id}`, {
        method: "PATCH",
        body,
    });
}
