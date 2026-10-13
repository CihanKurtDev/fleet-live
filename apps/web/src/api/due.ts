import type {
    DueListQuery,
    DueListResponse,
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
