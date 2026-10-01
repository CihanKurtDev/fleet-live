import { afterEach, describe, expect, it, vi } from "vitest";

import { request, setUnauthorizedHandler } from "./client";

describe("auth request errors", () => {
    afterEach(() => {
        setUnauthorizedHandler(null);
        vi.unstubAllGlobals();
    });

    const fail = (path: string, status: number, body: unknown) => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                Response.json(body, {
                    status,
                    headers: { "Content-Type": "application/json" },
                }),
            ),
        );

        return request(path, { method: "POST", body: {} });
    };

    it("keeps the session on a wrong password, a second factor, and a password change", async () => {
        const onUnauthorized = vi.fn();
        setUnauthorizedHandler(onUnauthorized);

        await expect(
            fail("/api/auth/login", 401, {
                error: "E-Mail oder Passwort ist falsch.",
                code: "INVALID_CREDENTIALS",
            }),
        ).rejects.toMatchObject({
            status: 401,
            code: "INVALID_CREDENTIALS",
        });
        await expect(
            fail("/api/auth/totp", 401, {
                error: "Code ist falsch.",
                code: "INVALID_CODE",
            }),
        ).rejects.toMatchObject({ code: "INVALID_CODE" });
        await expect(
            fail("/api/auth/password", 401, {
                error: "Aktuelles Passwort ist falsch.",
            }),
        ).rejects.toMatchObject({ status: 401 });

        expect(onUnauthorized).not.toHaveBeenCalled();
    });

    it("clears the session when another request is unauthorized", async () => {
        const onUnauthorized = vi.fn();
        setUnauthorizedHandler(onUnauthorized);

        await expect(
            fail("/api/auth/me", 401, { error: "Nicht angemeldet." }),
        ).rejects.toMatchObject({ status: 401 });

        expect(onUnauthorized).toHaveBeenCalledOnce();
    });

    it("keeps the company id from a required company login", async () => {
        await expect(
            fail("/api/auth/login", 403, {
                error: "Diese Firma verlangt den Firmen-Login.",
                code: "SSO_REQUIRED",
                details: { sso_company_id: 4 },
            }),
        ).rejects.toMatchObject({
            code: "SSO_REQUIRED",
            details: { sso_company_id: 4 },
        });
    });
});
