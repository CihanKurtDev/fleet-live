import { ApiError, isAbortError } from "./client";

export function isTransientApiError(error: unknown): boolean {
    if (isAbortError(error)) {
        return false;
    }

    if (error instanceof ApiError) {
        return (
            error.status === 502 ||
            error.status === 503 ||
            error.status === 504
        );
    }

    return error instanceof TypeError;
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(
                signal.reason ?? new DOMException("Aborted", "AbortError"),
            );
            return;
        }

        const timer = window.setTimeout(resolve, ms);

        signal.addEventListener(
            "abort",
            () => {
                window.clearTimeout(timer);
                reject(
                    signal.reason ??
                        new DOMException("Aborted", "AbortError"),
                );
            },
            { once: true },
        );
    });
}

export async function retryTransient<T>(
    run: () => Promise<T>,
    signal: AbortSignal,
): Promise<T> {
    let attempt = 0;

    while (true) {
        try {
            return await run();
        } catch (error) {
            if (signal.aborted || isAbortError(error)) {
                throw error;
            }

            if (!isTransientApiError(error)) {
                throw error;
            }

            const delay = Math.min(2000, 400 * 2 ** Math.min(attempt, 3));
            attempt += 1;
            await sleep(delay, signal);
        }
    }
}
