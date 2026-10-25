import { randomBytes } from "node:crypto";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { config } from "../config";
import { ServiceUnavailableError, ValidationError } from "./errors";

export type OidcProfile = {
    /** `iss` of the validated ID token. */
    issuer: string;
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

/*
 * The issuer of a company login is typed in by a dispatcher, and its metadata
 * names further URLs (keys, token endpoint). Every request to an identity
 * provider therefore goes through `guardedFetch`: HTTPS only, no redirects,
 * a timeout, a size cap, and no address in a private, loopback, link-local or
 * otherwise internal range, checked on the address the socket really connects
 * to (after DNS, so a name that resolves inward is refused too).
 *
 * An internal identity provider is allowed only by naming its host in
 * `OIDC_PRIVATE_HOSTS`; the server logs that list at start.
 */

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

const blocked = new BlockList();

for (const [network, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
] as const) {
    blocked.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
    ["::", 128],
    ["::1", 128],
    ["64:ff9b::", 96],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["fc00::", 7],
    ["fe80::", 10],
    ["fec0::", 10],
    ["ff00::", 8],
] as const) {
    blocked.addSubnet(network, prefix, "ipv6");
}

/** The IPv4 address inside an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`). */
function mappedIpv4(address: string): string | undefined {
    const match = /^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(address);

    if (match) {
        return match[1];
    }

    const hex = /^::ffff:(?:0:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);

    if (!hex) {
        return undefined;
    }

    const high = Number.parseInt(hex[1] ?? "0", 16);
    const low = Number.parseInt(hex[2] ?? "0", 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

/** Whether an address must not be reached from the server on behalf of a company. */
export function isBlockedAddress(address: string): boolean {
    const family = isIP(address);

    if (family === 4) {
        return blocked.check(address, "ipv4");
    }

    if (family === 6) {
        const v4 = mappedIpv4(address);
        return v4 ? blocked.check(v4, "ipv4") : blocked.check(address, "ipv6");
    }

    return true;
}

function privateHostAllowed(hostname: string): boolean {
    return config.oidcPrivateHosts.includes(hostname.toLowerCase());
}

/**
 * Checks an issuer before it is saved or used: an absolute HTTPS URL without
 * credentials, query or fragment, and not an internal address.
 */
export function assertSafeIssuer(issuer: string) {
    let url: URL;

    try {
        url = new URL(issuer);
    } catch {
        throw new ValidationError("Issuer ist keine gültige URL.", {
            sso_issuer: "Issuer ist keine gültige URL.",
        });
    }

    const reason =
        url.protocol !== "https:"
            ? "Der Issuer muss mit https:// beginnen."
            : url.username || url.password
              ? "Der Issuer darf keine Zugangsdaten enthalten."
              : url.search || url.hash
                ? "Der Issuer darf keine Parameter enthalten."
                : isIP(url.hostname.replace(/^\[|\]$/g, "")) &&
                    isBlockedAddress(url.hostname.replace(/^\[|\]$/g, "")) &&
                    !privateHostAllowed(url.hostname)
                  ? "Der Issuer zeigt auf eine interne Adresse."
                  : (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) &&
                      !privateHostAllowed(url.hostname)
                    ? "Der Issuer zeigt auf eine interne Adresse."
                    : undefined;

    if (reason) {
        throw new ValidationError(reason, { sso_issuer: reason });
    }
}

type LookupCallback = (
    error: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
) => void;

/** DNS lookup for the socket: refuses a name that resolves to an internal address. */
export function guardedLookup(
    hostname: string,
    options: { all?: boolean } | number | undefined,
    callback: LookupCallback,
) {
    dnsLookup(hostname, { all: true }, (error, addresses) => {
        if (error) {
            callback(error, []);
            return;
        }

        const list = addresses as LookupAddress[];
        const allowInternal = privateHostAllowed(hostname);
        const refused = list.find((entry) => isBlockedAddress(entry.address));

        if (list.length === 0 || (refused && !allowInternal)) {
            const failure: NodeJS.ErrnoException = new Error(
                `OIDC host ${hostname} resolves to a refused address.`,
            );
            failure.code = "EOIDCADDRESS";
            callback(failure, []);
            return;
        }

        const wantsAll = typeof options === "object" && options?.all === true;

        if (wantsAll) {
            callback(null, list);
            return;
        }

        const first = list[0] as LookupAddress;
        callback(null, first.address, first.family);
    });
}

function bodyOf(body: unknown): Buffer | undefined {
    if (body === undefined || body === null) {
        return undefined;
    }

    if (typeof body === "string" || body instanceof URLSearchParams) {
        return Buffer.from(String(body));
    }

    if (body instanceof Uint8Array) {
        return Buffer.from(body);
    }

    if (body instanceof ArrayBuffer) {
        return Buffer.from(new Uint8Array(body));
    }

    throw new TypeError("Unsupported OIDC request body.");
}

/** `fetch` for openid-client with the checks described above. */
export async function guardedFetch(
    input: string | URL,
    init: {
        method?: string;
        headers?: ConstructorParameters<typeof Headers>[0];
        body?: unknown;
        signal?: AbortSignal | null;
    } = {},
): Promise<Response> {
    const url = new URL(String(input));
    const host = url.hostname.replace(/^\[|\]$/g, "");

    if (url.protocol !== "https:") {
        throw new TypeError("OIDC requests must use https.");
    }

    if (isIP(host) && isBlockedAddress(host) && !privateHostAllowed(host)) {
        throw new TypeError(`OIDC host ${host} is a refused address.`);
    }

    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = bodyOf(init.body);
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;

    return new Promise<Response>((resolve, reject) => {
        const req = httpsRequest(
            url,
            {
                method: init.method ?? "GET",
                headers: body
                    ? { ...headers, "content-length": String(body.length) }
                    : headers,
                lookup: guardedLookup as never,
                signal,
            },
            (res) => {
                const chunks: Buffer[] = [];
                let size = 0;

                res.on("data", (chunk: Buffer) => {
                    size += chunk.length;

                    if (size > MAX_RESPONSE_BYTES) {
                        req.destroy(new Error("OIDC response is too large."));
                        return;
                    }

                    chunks.push(chunk);
                });
                res.on("error", reject);
                res.on("end", () => {
                    const responseHeaders = new Headers();

                    for (const [name, value] of Object.entries(res.headers)) {
                        for (const item of Array.isArray(value) ? value : [value]) {
                            if (item !== undefined) {
                                responseHeaders.append(name, item);
                            }
                        }
                    }

                    const status = res.statusCode ?? 502;
                    const noBody = status === 204 || status === 304;
                    resolve(
                        new Response(noBody ? null : Buffer.concat(chunks), {
                            status,
                            statusText: res.statusMessage,
                            headers: responseHeaders,
                        }),
                    );
                });
            },
        );

        req.on("error", reject);
        req.end(body);
    });
}

async function realDriver(): Promise<OidcDriver> {
    const oidc = await import("openid-client");

    const discover = (input: OidcRequest) => {
        assertSafeIssuer(input.issuer);

        return oidc.discovery(
            new URL(input.issuer),
            input.clientId,
            input.clientSecret,
            undefined,
            { [oidc.customFetch]: guardedFetch, timeout: REQUEST_TIMEOUT_MS / 1000 },
        );
    };

    return {
        async authorizationUrl(input) {
            const configuration = await discover(input);
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
            const configuration = await discover(input);
            // Checks state, PKCE, nonce, the token signature, `iss`, `aud`
            // and the expiry before any claim is read.
            const tokens = await oidc.authorizationCodeGrant(
                configuration,
                new URL(input.currentUrl),
                {
                    pkceCodeVerifier: input.codeVerifier,
                    expectedState: input.state,
                    expectedNonce: input.nonce,
                    idTokenExpected: true,
                },
            );
            const claims = tokens.claims();
            const email = typeof claims?.email === "string" ? claims.email : "";
            const name =
                typeof claims?.name === "string" && claims.name.trim()
                    ? claims.name
                    : email;

            if (!email || typeof claims?.sub !== "string" || typeof claims.iss !== "string") {
                throw new ServiceUnavailableError(
                    "Der Login hat keine E-Mail geliefert.",
                    "SSO_UNAVAILABLE",
                );
            }

            return {
                issuer: claims.iss,
                subject: claims.sub,
                email: email.toLowerCase(),
                emailVerified: claims.email_verified === true,
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

const ENTRA_ISSUER = /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/;

/**
 * Whether the validated `iss` of a token belongs to the provider the flow was
 * started for. Entra's multi-tenant endpoint names the tenant only in the token.
 */
export function issuerMatches(expected: string, actual: string): boolean {
    if (!actual) {
        return false;
    }

    if (expected === "https://login.microsoftonline.com/common/v2.0") {
        return ENTRA_ISSUER.test(actual);
    }

    try {
        return new URL(expected).href === new URL(actual).href;
    } catch {
        return false;
    }
}
