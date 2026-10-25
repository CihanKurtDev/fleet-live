import type { Request, Response } from "express";
import { parseEmailInput, parseSsoLinkInput } from "@fleet-live/shared";
import { config } from "../config";
import { NotFoundError, UnauthorizedError, ValidationError } from "../lib/errors";
import {
    clearCookieHeader,
    namedCookieHeader,
    readCookie,
    SESSION_COOKIE,
    SSO_COOKIE,
} from "../lib/cookies";
import {
    hasOidcTestDriver,
    issuerMatches,
    newOidcSecrets,
    oidcAuthorizationUrl,
    oidcCallback,
    publicProviderConfigured,
    type OidcProfile,
} from "../lib/oidc";
import { continueLogin, type LoginOutcome } from "../lib/openSession";
import {
    findSsoUser,
    linkSsoIdentity,
    pickLoginCompany,
    companyIdForLoginSso,
    ssoClient,
} from "../models/account.model";
import { membershipRow } from "../models/authView";
import { AuthTokenModel } from "../models/authToken.model";
import { companyProvider } from "../models/loginPolicy";
import { SessionModel } from "../models/session.model";
import { UserModel } from "../models/user.model";

type SsoProvider = "google" | "microsoft" | "company";

/**
 * A link is either made by the signed-in owner (`session`), or by a member of
 * a company that requires its own login, right after password and second
 * factor (`challenge`, from an `sso_link` step).
 */
type SsoLink =
    | { userId: number; via: "session" }
    | { userId: number; via: "challenge"; mfa: boolean };

type SsoPayload = {
    provider: SsoProvider;
    companyId: number | null;
    nonce: string;
    codeVerifier: string;
    link?: SsoLink;
};

const GOOGLE_ISSUER = "https://accounts.google.com";
const MICROSOFT_ISSUER = "https://login.microsoftonline.com/common/v2.0";

function fail(res: Response, reason: string) {
    res.redirect(`${config.webOrigin}/login?sso=${reason}`);
}

function linkResult(res: Response, reason: string) {
    res.redirect(`${config.webOrigin}/konto?sso=${reason}`);
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

function providerKey(provider: SsoProvider, companyId: number | null): string {
    return provider === "company" && companyId
        ? companyProvider(companyId)
        : provider;
}

export async function startSso(req: Request, res: Response) {
    const provider = ssoProvider(req.params.provider);

    if (!provider || provider === "company") {
        fail(res, "error");
        return;
    }

    const started = await authorizationFor({ provider, companyId: null });

    if (!started) {
        fail(res, "unconfigured");
        return;
    }

    res.append("Set-Cookie", namedCookieHeader(SSO_COOKIE, started.state, 600));
    res.redirect(started.url);
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

    const started = await authorizationFor({ provider: "company", companyId });

    if (!started) {
        fail(res, "unconfigured");
        return;
    }

    res.append("Set-Cookie", namedCookieHeader(SSO_COOKIE, started.state, 600));
    res.redirect(started.url);
}

/**
 * `POST /api/auth/sso/link`: starts linking an external login to an account.
 * Signed in, the owner links any provider (a company login only of a company
 * they belong to). Without a session, only an `sso_link` step from the login
 * of a company that requires its own login is accepted, for that company.
 * Answers the URL of the provider; the browser goes there.
 */
export async function startSsoLink(req: Request, res: Response) {
    const input = parseSsoLinkInput(req.body);
    const companyId = input.provider === "company" ? (input.company_id ?? null) : null;
    let link: SsoLink;

    if (input.challenge) {
        const step = AuthTokenModel.claim(input.challenge, "sso_link");

        if (
            !step?.user_id ||
            input.provider !== "company" ||
            step.company_id !== companyId
        ) {
            throw new UnauthorizedError("Der Schritt ist abgelaufen. Melde dich neu an.");
        }

        const payload = JSON.parse(step.payload ?? "{}") as { mfa?: boolean };
        link = { userId: step.user_id, via: "challenge", mfa: payload.mfa === true };
    } else {
        if (!req.user) {
            throw new UnauthorizedError();
        }

        if (companyId !== null && !membershipRow(req.user.id, companyId)) {
            throw new NotFoundError("Firma nicht gefunden.");
        }

        link = { userId: req.user.id, via: "session" };
    }

    const started = await authorizationFor({ provider: input.provider, companyId, link });

    if (!started) {
        throw new ValidationError("Dieser Login ist hier nicht konfiguriert.");
    }

    res.append("Set-Cookie", namedCookieHeader(SSO_COOKIE, started.state, 600));
    res.json({ url: started.url });
}

async function authorizationFor(input: {
    provider: SsoProvider;
    companyId: number | null;
    link?: SsoLink;
}): Promise<{ url: string; state: string } | undefined> {
    const creds = credentials(input.provider, input.companyId);

    if (!creds) {
        return undefined;
    }

    const secrets = newOidcSecrets();
    const state = AuthTokenModel.issue({
        purpose: "sso_state",
        ttl: "+10 minutes",
        companyId: input.companyId,
        userId: input.link?.userId ?? null,
        payload: JSON.stringify({
            provider: input.provider,
            companyId: input.companyId,
            nonce: secrets.nonce,
            codeVerifier: secrets.codeVerifier,
            link: input.link,
        } satisfies SsoPayload),
    });

    try {
        const url = await oidcAuthorizationUrl({
            issuer: creds.issuer,
            clientId: creds.clientId,
            clientSecret: creds.clientSecret,
            redirectUri: redirectUri(input.provider),
            state,
            nonce: secrets.nonce,
            codeVerifier: secrets.codeVerifier,
        });

        return { url, state };
    } catch {
        return undefined;
    }
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

    // Used up before the provider is asked: of two callbacks with the same
    // state (a replay, a double click) only one gets this far.
    const row = AuthTokenModel.claim(state, "sso_state");
    res.append("Set-Cookie", clearCookieHeader(SSO_COOKIE));

    if (!row?.payload) {
        fail(res, "error");
        return;
    }

    const payload = JSON.parse(row.payload) as SsoPayload;
    const creds = credentials(payload.provider, payload.companyId);

    if (!creds || payload.provider !== provider) {
        fail(res, creds ? "error" : "unconfigured");
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
        failFlow(res, payload, "error");
        return;
    }

    // The library has checked the token; this checks it is the provider this
    // flow was started for and that it names a subject.
    if (!profile.subject || !issuerMatches(creds.issuer, profile.issuer)) {
        failFlow(res, payload, "error");
        return;
    }

    const key = providerKey(payload.provider, payload.companyId);

    if (payload.link) {
        finishLink(req, res, { ...payload, link: payload.link }, key, profile);
        return;
    }

    const user = findSsoUser(key, profile.issuer, profile.subject);

    if (!user) {
        fail(res, "unknown");
        return;
    }

    const companyId =
        payload.provider === "company" && payload.companyId
            ? payload.companyId
            : pickLoginCompany(user.id)?.company_id;

    if (!companyId) {
        fail(res, "unknown");
        return;
    }

    redirectOutcome(
        res,
        continueLogin(req, res, {
            userId: user.id,
            companyId,
            remember: true,
            mfa: false,
            ssoCompanyId: payload.provider === "company" ? companyId : null,
        }),
    );
}

function failFlow(res: Response, payload: SsoPayload, reason: string) {
    if (payload.link?.via === "session") {
        linkResult(res, reason);
        return;
    }

    fail(res, reason);
}

function finishLink(
    req: Request,
    res: Response,
    payload: SsoPayload & { link: SsoLink },
    key: string,
    profile: OidcProfile,
) {
    const link = payload.link;
    const owner = UserModel.getById(link.userId);

    // A session link needs the same person still signed in in this browser.
    if (link.via === "session") {
        const token = readCookie(req.headers.cookie, SESSION_COOKIE);
        const session = token ? SessionModel.findUser(token) : undefined;

        if (!owner || session?.id !== owner.id) {
            linkResult(res, "error");
            return;
        }
    }

    if (!owner) {
        fail(res, "error");
        return;
    }

    // Not a match by e-mail but a consistency check: the provider must vouch
    // for the very address of the account it is linked to.
    if (!profile.emailVerified || profile.email !== owner.email) {
        failFlow(res, payload, "mismatch");
        return;
    }

    const result = linkSsoIdentity({
        userId: owner.id,
        provider: key,
        issuer: profile.issuer,
        subject: profile.subject,
    });

    if (link.via === "session") {
        linkResult(res, result);
        return;
    }

    if (result === "taken" || payload.companyId === null) {
        fail(res, result === "taken" ? "taken" : "error");
        return;
    }

    redirectOutcome(
        res,
        continueLogin(req, res, {
            userId: owner.id,
            companyId: payload.companyId,
            remember: true,
            mfa: link.mfa,
            ssoCompanyId: payload.companyId,
        }),
    );
}

/**
 * Where the browser goes after a provider: into the app with a session, back
 * to the sign-in page for the second factor (the step in the fragment, which
 * no server and no Referer sees), or to the sign-in page with the reason.
 */
function redirectOutcome(res: Response, outcome: LoginOutcome) {
    if (outcome.kind === "session") {
        res.redirect(`${config.webOrigin}/`);
        return;
    }

    if (outcome.kind === "totp") {
        const fragment = new URLSearchParams({
            challenge: outcome.challenge,
            step: outcome.step,
        });
        res.redirect(`${config.webOrigin}/login#${fragment.toString()}`);
        return;
    }

    fail(res, outcome.kind === "sso_required" ? "company" : "unknown");
}
