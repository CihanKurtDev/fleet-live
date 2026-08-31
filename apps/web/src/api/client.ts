import type { VehicleFieldErrors } from "@fleet-live/shared";

export class ApiError extends Error {
    readonly status: number;
    readonly fields?: VehicleFieldErrors;

    constructor(
        message: string,
        status: number,
        fields?: VehicleFieldErrors,
    ) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.fields = fields;
    }
}

interface RequestOptions {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    timeoutMs?: number;
}

async function parseBody(response: Response): Promise<unknown> {
    if (response.status === 204) {
        return undefined;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
        return undefined;
    }

    return response.json();
}

export function isAbortError(error: unknown): boolean {
    if (error instanceof DOMException && error.name === "AbortError") {
        return true;
    }

    return (
        error instanceof Error &&
        (error.name === "AbortError" ||
            error.message === "signal is aborted without reason" ||
            error.message.toLowerCase().includes("aborted"))
    );
}

export async function request<T>(
    path: string,
    options: RequestOptions = {},
): Promise<T> {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 10_000);
    const signal = options.signal
        ? AbortSignal.any([options.signal, timeout])
        : timeout;

    const response = await fetch(path, {
        method: options.method ?? "GET",
        headers: options.body
            ? { "Content-Type": "application/json" }
            : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined,
        credentials: "include",
        signal,
    });

    const payload = (await parseBody(response)) as
        | { error?: string; fields?: VehicleFieldErrors }
        | T
        | undefined;

    if (!response.ok) {
        const errorPayload = payload as
            | { error?: string; fields?: VehicleFieldErrors }
            | undefined;

        throw new ApiError(
            errorPayload?.error ?? `Request failed with ${response.status}.`,
            response.status,
            errorPayload?.fields,
        );
    }

    return payload as T;
}
