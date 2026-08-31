import type { Response } from "express";
import { config } from "../config";

export const SESSION_COOKIE = "fleet_session";
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function readCookie(
    header: string | undefined,
    name: string,
): string | undefined {
    if (!header) {
        return undefined;
    }

    for (const part of header.split(";")) {
        const trimmed = part.trim();
        const separator = trimmed.indexOf("=");

        if (separator === -1) {
            continue;
        }

        if (trimmed.slice(0, separator) !== name) {
            continue;
        }

        return decodeURIComponent(trimmed.slice(separator + 1));
    }

    return undefined;
}

const cookieFlags = () => {
    const parts = ["Path=/", "HttpOnly", "SameSite=Lax"];

    if (config.isProduction) {
        parts.push("Secure");
    }

    return parts.join("; ");
};

export function setSessionCookie(
    response: Response,
    token: string,
    persist: boolean,
) {
    const maxAge = persist
        ? `; Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`
        : "";

    response.setHeader(
        "Set-Cookie",
        `${SESSION_COOKIE}=${encodeURIComponent(token)}${maxAge}; ${cookieFlags()}`,
    );
}

export function clearSessionCookie(response: Response) {
    response.setHeader(
        "Set-Cookie",
        `${SESSION_COOKIE}=; Max-Age=0; ${cookieFlags()}`,
    );
}
