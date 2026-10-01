export class ApiError extends Error {
    readonly status: number;
    readonly code?: string;
    readonly fields?: Record<string, string>;
    readonly details?: Record<string, unknown>;

    constructor(
        message: string,
        status: number,
        fields?: Record<string, string>,
        code?: string,
        details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.code = code;
        this.fields = fields;
        this.details = details;
    }
}

interface RequestOptions {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    timeoutMs?: number;
}

/** Falsches Passwort oder ein zweiter Faktor ist auch 401, ohne dass die Session endet. */
const isLoginAttempt = (path: string) =>
    path === "/api/auth/login" ||
    path === "/api/auth/totp" ||
    path === "/api/auth/password";

type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Wird von AuthProvider gesetzt: User leeren → RequireAuth schickt zu /login. */
export const setUnauthorizedHandler = (handler: UnauthorizedHandler | null) => {
    unauthorizedHandler = handler;
};

export const notifyUnauthorized = () => {
    unauthorizedHandler?.();
};

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
        | {
              error?: string;
              code?: string;
              fields?: Record<string, string>;
              details?: Record<string, unknown>;
          }
        | T
        | undefined;

    if (!response.ok) {
        if (response.status === 401 && !isLoginAttempt(path)) {
            notifyUnauthorized();
        }

        const errorPayload = payload as
            | {
                  error?: string;
                  code?: string;
                  fields?: Record<string, string>;
                  details?: Record<string, unknown>;
              }
            | undefined;

        throw new ApiError(
            errorPayload?.error ?? `Request failed with ${response.status}.`,
            response.status,
            errorPayload?.fields,
            errorPayload?.code,
            errorPayload?.details,
        );
    }

    return payload as T;
}
