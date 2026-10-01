import { randomBytes } from "node:crypto";
import { config } from "../config";
import { ServiceUnavailableError } from "./errors";

export type OidcProfile = {
    subject: string;
    email: string;
    emailVerified: boolean;
    name: string;
};

export type OidcRequest = {
    issuer: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    state: string;
    nonce: string;
    codeVerifier: string;
};

type OidcDriver = {
    authorizationUrl(input: OidcRequest): Promise<string>;
    callback(input: OidcRequest & { currentUrl: string }): Promise<OidcProfile>;
};

let testDriver: OidcDriver | null = null;

export function setOidcDriverForTests(driver: OidcDriver | null) {
    if (!config.isTest) {
        throw new Error("OIDC-Testtreiber nur in Tests.");
    }

    testDriver = driver;
}

export function hasOidcTestDriver() {
    return testDriver !== null;
}

export function publicProviderConfigured(clientId: string, clientSecret: string) {
    return Boolean(clientId && clientSecret);
}

export function newOidcSecrets() {
    return {
        state: randomBytes(16).toString("base64url"),
        nonce: randomBytes(16).toString("base64url"),
        codeVerifier: randomBytes(32).toString("base64url"),
    };
}

async function realDriver(): Promise<OidcDriver> {
    const oidc = await import("openid-client");

    return {
        async authorizationUrl(input) {
            const configuration = await oidc.discovery(
                new URL(input.issuer),
                input.clientId,
                input.clientSecret,
            );
            const url = oidc.buildAuthorizationUrl(configuration, {
                redirect_uri: input.redirectUri,
                scope: "openid email profile",
                state: input.state,
                nonce: input.nonce,
                code_challenge: await oidc.calculatePKCECodeChallenge(
                    input.codeVerifier,
                ),
                code_challenge_method: "S256",
            });

            return url.href;
        },

        async callback(input) {
            const configuration = await oidc.discovery(
                new URL(input.issuer),
                input.clientId,
                input.clientSecret,
            );
            const tokens = await oidc.authorizationCodeGrant(
                configuration,
                new URL(input.currentUrl),
                {
                    pkceCodeVerifier: input.codeVerifier,
                    expectedState: input.state,
                    expectedNonce: input.nonce,
                },
            );
            const claims = tokens.claims();
            const email = typeof claims?.email === "string" ? claims.email : "";
            const name =
                typeof claims?.name === "string" && claims.name.trim()
                    ? claims.name
                    : email;

            if (!email) {
                throw new ServiceUnavailableError(
                    "Der Login hat keine E-Mail geliefert.",
                    "SSO_UNAVAILABLE",
                );
            }

            return {
                subject: String(claims?.sub ?? ""),
                email: email.toLowerCase(),
                emailVerified: claims?.email_verified === true,
                name,
            };
        },
    };
}

async function driver(): Promise<OidcDriver> {
    return testDriver ?? realDriver();
}

function assertConfigured(input: OidcRequest) {
    if (testDriver) {
        return;
    }

    if (!publicProviderConfigured(input.clientId, input.clientSecret)) {
        throw new ServiceUnavailableError(
            "SSO ist nicht konfiguriert.",
            "SSO_UNAVAILABLE",
        );
    }
}

export async function oidcAuthorizationUrl(input: OidcRequest): Promise<string> {
    assertConfigured(input);
    return (await driver()).authorizationUrl(input);
}

export async function oidcCallback(
    input: OidcRequest & { currentUrl: string },
): Promise<OidcProfile> {
    assertConfigured(input);
    return (await driver()).callback(input);
}
