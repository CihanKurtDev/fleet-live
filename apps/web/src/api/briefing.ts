import type { BriefingResponse } from "@fleet-live/shared";
import { request } from "./client";

let inflight: Promise<BriefingResponse> | null = null;

function followUntilAborted<T>(
    promise: Promise<T>,
    signal?: AbortSignal,
): Promise<T> {
    if (!signal) {
        return promise;
    }

    if (signal.aborted) {
        return Promise.reject(
            signal.reason ?? new DOMException("Aborted", "AbortError"),
        );
    }

    return new Promise((resolve, reject) => {
        const onAbort = () => {
            reject(
                signal.reason ?? new DOMException("Aborted", "AbortError"),
            );
        };

        signal.addEventListener("abort", onAbort, { once: true });

        promise.then(
            (value) => {
                signal.removeEventListener("abort", onAbort);
                if (signal.aborted) {
                    onAbort();
                    return;
                }
                resolve(value);
            },
            (error) => {
                signal.removeEventListener("abort", onAbort);
                reject(error);
            },
        );
    });
}

export function getBriefing(signal?: AbortSignal) {
    if (!inflight) {
        inflight = request<BriefingResponse>("/api/briefing").finally(() => {
            inflight = null;
        });
    }

    return followUntilAborted(inflight, signal);
}
