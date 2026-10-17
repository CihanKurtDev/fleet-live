import type { TodayResponse } from "@fleet-live/shared";
import { request } from "./client";

/** The Schicht task list: the `limit` most urgent tasks plus all counts. */
export function getToday(limit: number, signal?: AbortSignal) {
    return request<TodayResponse>(`/api/today?limit=${limit}`, { signal });
}
