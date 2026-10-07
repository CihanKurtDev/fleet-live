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
