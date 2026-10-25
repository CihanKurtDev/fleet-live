import type { Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { config } from "../config";

const common = {
    windowMs: 15 * 60 * 1000,
    standardHeaders: "draft-8" as const,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    skip: () => config.isTest,
    message: {
        error: "Zu viele Anmeldeversuche. Bitte später erneut versuchen.",
        code: "LOGIN_RATE_LIMITED",
    },
};

export const loginIpRateLimit = rateLimit({
    ...common,
    limit: 20,
});

/**
 * Wrong single-use links (reset, e-mail confirmation, invite) per address:
 * the tokens are 256-bit, this keeps scanners from hammering the routes.
 */
export const tokenIpRateLimit = rateLimit({
    ...common,
    limit: 20,
    message: {
        error: "Zu viele ungültige Links. Bitte später erneut versuchen.",
        code: "AUTH_RATE_LIMITED",
    },
});

/**
 * Starts of a login at an identity provider per address. Every start writes a
 * state row, so successful redirects count too.
 */
export const ssoStartRateLimit = rateLimit({
    ...common,
    skipSuccessfulRequests: false,
    limit: 30,
    message: {
        error: "Zu viele Anmeldeversuche. Bitte später erneut versuchen.",
        code: "LOGIN_RATE_LIMITED",
    },
});

export const authIpRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: () => config.isTest,
    message: {
        error: "Zu viele Versuche. Bitte später erneut versuchen.",
        code: "AUTH_RATE_LIMITED",
    },
});

export const loginAccountRateLimit = rateLimit({
    ...common,
    limit: 8,
    keyGenerator: (req: Request) => {
        const email =
            typeof req.body?.email === "string"
                ? req.body.email.trim().toLowerCase()
                : "";

        return email || ipKeyGenerator(req.ip ?? "unknown");
    },
});
