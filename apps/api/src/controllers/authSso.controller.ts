import type { Request, Response } from "express";
import { parseEmailInput } from "@fleet-live/shared";
import { config } from "../config";
import { ValidationError } from "../lib/errors";
import {
    clearCookieHeader,
    namedCookieHeader,
    readCookie,
    sessionCookieHeader,
    SSO_COOKIE,
} from "../lib/cookies";
import {
    hasOidcTestDriver,
    newOidcSecrets,
    oidcAuthorizationUrl,
    oidcCallback,
    publicProviderConfigured,
    type OidcProfile,
} from "../lib/oidc";
import {
    findSsoUser,
    linkSsoIdentity,
    pickLoginCompany,
    companyIdForLoginSso,
    ssoClient,
} from "../models/account.model";
import { membershipRow } from "../models/authView";
import { AuthTokenModel } from "../models/authToken.model";
import { SessionModel } from "../models/session.model";
import { UserModel } from "../models/user.model";

type SsoProvider = "google" | "microsoft" | "company";

type SsoPayload = {
    provider: SsoProvider;
    companyId: number | null;
    nonce: string;
    codeVerifier: string;
};

const GOOGLE_ISSUER = "https://accounts.google.com";
const MICROSOFT_ISSUER = "https://login.microsoftonline.com/common/v2.0";

function fail(res: Response, reason: string) {
    res.redirect(`${config.webOrigin}/login?sso=${reason}`);
}

function envCredentials(
    issuer: string,
    clientId: string,
    clientSecret: string,
) {
    if (
        publicProviderConfigured(clientId, clientSecret) ||
        hasOidcTestDriver()
    ) {
        return { issuer, clientId, clientSecret };
    }

    return undefined;
}

export function listSsoProviders(_req: Request, res: Response) {
    res.json({
        google: publicProviderConfigured(
            config.googleClientId,
            config.googleClientSecret,
        ),
        microsoft: publicProviderConfigured(
            config.microsoftClientId,
            config.microsoftClientSecret,
        ),
    });
}

function credentials(provider: SsoProvider, companyId: number | null) {
    if (provider === "google") {
        return envCredentials(
            GOOGLE_ISSUER,
            config.googleClientId,
            config.googleClientSecret,
        );
    }

    if (provider === "microsoft") {
        return envCredentials(
            MICROSOFT_ISSUER,
            config.microsoftClientId,
            config.microsoftClientSecret,
        );
    }

    if (!companyId) {
        return undefined;
    }

    return ssoClient(companyId);
}

function redirectUri(provider: SsoProvider): string {
    const path =
        provider === "company"
            ? "/api/auth/sso/company/callback"
            : `/api/auth/sso/${provider}/callback`;

    return `${config.webOrigin}${path}`;
}

export async function startSso(req: Request, res: Response) {
    const provider = ssoProvider(req.params.provider);

    if (!provider || provider === "company") {
        fail(res, "error");
        return;
    }

    await startProvider(res, provider, null);
}

export function discoverCompanySso(req: Request, res: Response) {
    const { email } = parseEmailInput(req.body);
    const companyId = companyIdForLoginSso(email);

    if (!companyId) {
        throw new ValidationError(
            "Für diese E-Mail ist kein Firmen-Login hinterlegt.",
        );
    }

    res.json({ company_id: companyId });
}

export async function startCompanySso(req: Request, res: Response) {
    const companyId = Number(req.query.company_id);

    if (!Number.isInteger(companyId) || companyId < 1) {
        fail(res, "error");
        return;
    }

    await startProvider(res, "company", companyId);
}

async function startProvider(
    res: Response,
    provider: SsoProvider,
    companyId: number | null,
) {
    const creds = credentials(provider, companyId);

    if (!creds) {
        fail(res, "unconfigured");
        return;
    }

    const secrets = newOidcSecrets();
    const token = AuthTokenModel.issue({
        purpose: "sso_state",
        ttl: "+10 minutes",
        companyId,
        payload: JSON.stringify({
            provider,
            companyId,
            nonce: secrets.nonce,
            codeVerifier: secrets.codeVerifier,
            state: secrets.state,
        } satisfies SsoPayload & { state: string }),
    });

    let url: string;

    try {
        url = await oidcAuthorizationUrl({
            issuer: creds.issuer,
            clientId: creds.clientId,
            clientSecret: creds.clientSecret,
            redirectUri: redirectUri(provider),
            state: token,
            nonce: secrets.nonce,
            codeVerifier: secrets.codeVerifier,
        });
    } catch {
        fail(res, "unconfigured");
        return;
    }

    res.setHeader("Set-Cookie", namedCookieHeader(SSO_COOKIE, token, 600));
    res.redirect(url);
}

function ssoProvider(
    value: string | string[] | undefined,
): SsoProvider | undefined {
    const raw = Array.isArray(value) ? value[0] : value;

    if (raw === "google" || raw === "microsoft" || raw === "company") {
        return raw;
    }

    return undefined;
}

export async function finishSso(req: Request, res: Response) {
    const provider = ssoProvider(
        req.path.includes("/company/")
            ? "company"
            : String(req.params.provider ?? ""),
    );

    if (!provider) {
        fail(res, "error");
        return;
    }

    const cookie = readCookie(req.headers.cookie, SSO_COOKIE);
    const state = typeof req.query.state === "string" ? req.query.state : "";

    if (!cookie || cookie !== state) {
        fail(res, "error");
        return;
    }

    const row = AuthTokenModel.find(state, "sso_state");

    if (!row?.payload) {
        fail(res, "error");
        return;
    }

    const payload = JSON.parse(row.payload) as SsoPayload;
    const creds = credentials(payload.provider, payload.companyId);

    if (!creds) {
        fail(res, "unconfigured");
        return;
    }

    let profile: OidcProfile;

    try {
        profile = await oidcCallback({
            issuer: creds.issuer,
            clientId: creds.clientId,
            clientSecret: creds.clientSecret,
            redirectUri: redirectUri(payload.provider),
            state,
            nonce: payload.nonce,
            codeVerifier: payload.codeVerifier,
            currentUrl: `${config.webOrigin}${req.originalUrl}`,
        });
    } catch {
        fail(res, "error");
        return;
    }

    AuthTokenModel.consume(row.id);
    const providerKey =
        payload.provider === "company" && payload.companyId
            ? `company:${payload.companyId}`
            : payload.provider;
    let user = findSsoUser(providerKey, profile.subject);

    if (!user) {
        const byEmail = UserModel.findByEmail(profile.email);
        user = byEmail
            ? linkSsoIdentity(
                  byEmail,
                  providerKey,
                  profile.subject,
                  profile.emailVerified,
              )
            : undefined;
    }

    if (!user) {
        fail(res, "unknown");
        return;
    }

    const companyId =
        payload.provider === "company" && payload.companyId
            ? payload.companyId
            : pickLoginCompany(user.id)?.company_id;

    if (!companyId || !membershipRow(user.id, companyId)) {
        fail(res, "unknown");
        return;
    }

    const session = SessionModel.create(user.id, companyId, true);
    res.setHeader("Set-Cookie", [
        sessionCookieHeader(session, true),
        clearCookieHeader(SSO_COOKIE),
    ]);
    res.redirect(`${config.webOrigin}/`);
}
