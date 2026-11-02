import "./env";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { setGeocoderEndpointForTests } from "../lib/geocoder";
import { UserModel } from "../models/user.model";
import { loginAs } from "./helpers";

let api: ReturnType<typeof request.agent>;
let stub: Server;
let stubUrl = "";
const seen: { q: string | null; agent: string | undefined }[] = [];

before(async () => {
    stub = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://stub");
        seen.push({ q: url.searchParams.get("q"), agent: req.headers["user-agent"] });
        res.setHeader("Content-Type", "application/json");
        res.end(
            JSON.stringify([
                { display_name: "Hauptstraße 1, 50667 Köln", lat: "50.9375", lon: "6.9603" },
                { display_name: "kaputt", lat: "x", lon: "6.9" },
            ]),
        );
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
    stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}/search`;
});

after(() => stub.close());

beforeEach(async () => {
    api = (await loginAs(1)).agent;
    seen.length = 0;
});

afterEach(() => {
    setGeocoderEndpointForTests("");
    UserModel.resetForTests();
});

describe("address search for workshops", () => {
    it("says it is off and refuses a search while no service is set", async () => {
        const config = await api.get("/api/workshop/geocode/config");
        assert.equal(config.status, 200);
        assert.equal(config.body.data.enabled, false);

        const search = await api.get("/api/workshop/geocode?q=Hauptstraße 1 Köln");
        assert.equal(search.status, 503);
        assert.equal(search.body.code, "GEOCODER_OFF");
    });

    it("asks the service once per query, with its own user agent, and keeps usable hits", async () => {
        setGeocoderEndpointForTests(stubUrl);
        assert.equal((await api.get("/api/workshop/geocode/config")).body.data.enabled, true);

        const first = await api.get("/api/workshop/geocode").query({ q: "Hauptstraße 1 Köln" });
        assert.equal(first.status, 200);
        assert.deepEqual(first.body.data, [
            { label: "Hauptstraße 1, 50667 Köln", latitude: 50.9375, longitude: 6.9603 },
        ]);

        const again = await api.get("/api/workshop/geocode").query({ q: "  hauptstraße 1   köln " });
        assert.equal(again.status, 200);
        assert.equal(seen.length, 1);
        assert.equal(seen[0]?.q, "Hauptstraße 1 Köln");
        assert.match(seen[0]?.agent ?? "", /fleet-live/);
    });

    it("validates the query and keeps viewers and strangers out", async () => {
        setGeocoderEndpointForTests(stubUrl);
        const short = await api.get("/api/workshop/geocode").query({ q: "ab" });
        assert.equal(short.status, 400);

        const viewer = (await loginAs(1, "viewer")).agent;
        assert.equal((await viewer.get("/api/workshop/geocode").query({ q: "Köln" })).status, 403);
        assert.equal((await viewer.get("/api/workshop/geocode/config")).status, 200);
        assert.equal((await request(app).get("/api/workshop/geocode/config")).status, 401);
        assert.equal(seen.length, 0);
    });
});
