import "./env";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { config } from "../config";
import {
    assertSafeIssuer,
    guardedFetch,
    isBlockedAddress,
    issuerMatches,
} from "../lib/oidc";
import { UserModel } from "../models/user.model";
import { loginAs } from "./helpers";

afterEach(() => {
    UserModel.resetForTests();
    setPrivateHosts([]);
});

function setPrivateHosts(hosts: string[]) {
    (config as { oidcPrivateHosts: string[] }).oidcPrivateHosts = hosts;
}

describe("addresses an identity provider must not resolve to", () => {
    it("include loopback, private, link-local, metadata and mapped forms", () => {
        for (const address of [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "::1",
            "::",
            "fe80::1",
            "fd00::1",
            "::ffff:127.0.0.1",
            "::ffff:7f00:1",
            "::ffff:a9fe:a9fe",
            "64:ff9b::a9fe:a9fe",
            "not-an-ip",
        ]) {
            assert.equal(isBlockedAddress(address), true, address);
        }
    });

    it("leave public addresses alone", () => {
        for (const address of ["8.8.8.8", "142.250.185.78", "2a00:1450:4001:82b::200e"]) {
            assert.equal(isBlockedAddress(address), false, address);
        }
    });
});

describe("an issuer", () => {
    it("is refused when it is not plain public https", () => {
        for (const issuer of [
            "http://login.example.com",
            "https://127.0.0.1",
            "https://[::1]",
            "https://10.0.0.5/realms/x",
            "https://localhost:8443",
            "https://idp.localhost",
            "https://user:pw@login.example.com",
            "https://login.example.com/?x=1",
            "file:///etc/passwd",
        ]) {
            assert.throws(() => assertSafeIssuer(issuer), /Issuer/, issuer);
        }

        assertSafeIssuer("https://login.example.com/realms/fleet");
    });

    it("is refused when a dispatcher saves it", async () => {
        const { agent } = await loginAs(1);

        for (const issuer of ["http://login.example.com", "https://169.254.169.254", "https://localhost"]) {
            const saved = await agent
                .patch("/api/auth/security")
                .send({ sso_issuer: issuer, sso_client_id: "c", sso_client_secret: "s" });
            assert.equal(saved.status, 400, issuer);
            assert.ok(saved.body.fields?.sso_issuer, issuer);
        }

        const security = await agent.get("/api/auth/security").expect(200);
        assert.equal(security.body.sso_issuer, null);
    });

    it("may be internal only when its host is named in OIDC_PRIVATE_HOSTS", () => {
        assert.throws(() => assertSafeIssuer("https://localhost:8443"));
        setPrivateHosts(["localhost"]);
        assertSafeIssuer("https://localhost:8443");
    });
});

describe("a request to an identity provider", () => {
    it("is refused for plain http", async () => {
        await assert.rejects(guardedFetch("http://example.com/.well-known/openid-configuration"), /https/);
    });

    it("is refused for an internal address before a connection is made", async () => {
        await assert.rejects(guardedFetch("https://127.0.0.1:9/x"), /refused/);
        await assert.rejects(guardedFetch("https://[::1]:9/x"), /refused/);
    });

    it("is refused when the name resolves to an internal address", async () => {
        await assert.rejects(guardedFetch("https://localhost:9/x"), (error: Error & { code?: string }) => {
            const code = error.code ?? (error.cause as { code?: string } | undefined)?.code;
            return code === "EOIDCADDRESS" || /refused address/.test(error.message);
        });
    });
});

describe("the issuer of a token", () => {
    it("must be the one the flow was started for", () => {
        assert.equal(issuerMatches("https://idp.example.com", "https://idp.example.com"), true);
        assert.equal(issuerMatches("https://idp.example.com", "https://idp.example.com/"), true);
        assert.equal(issuerMatches("https://idp.example.com", "https://evil.example.com"), false);
        assert.equal(issuerMatches("https://idp.example.com", ""), false);
        assert.equal(
            issuerMatches(
                "https://login.microsoftonline.com/common/v2.0",
                "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0",
            ),
            true,
        );
        assert.equal(
            issuerMatches(
                "https://login.microsoftonline.com/common/v2.0",
                "https://login.microsoftonline.com.evil.example/x/v2.0",
            ),
            false,
        );
    });
});
