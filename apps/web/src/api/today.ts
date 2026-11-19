import type { TodayResponse } from "@fleet-live/shared";
import { request } from "./client";

/** Schicht: „Heute“ (everything in use that may or can not drive) and the next working days. */
export function getToday(signal?: AbortSignal) {
    return request<TodayResponse>("/api/today", { signal });
}
