import "./env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { db } from "../db/database";
import { SiteModel } from "../models/site.model";
import { UserModel } from "../models/user.model";
import { VehicleModel } from "../models/vehicle.model";
import { loginAs } from "./helpers";

const DEPOT = { latitude: 50.9, longitude: 6.9, radius_m: 400 };

function insertDepot(
    companyId: number,
    name = "Köln",
    latitude = DEPOT.latitude,
    longitude = DEPOT.longitude,
    radius = DEPOT.radius_m,
) {
    const result = db
        .prepare(
            `
            INSERT INTO sites (
                company_id, name, kind, latitude, longitude, radius_m
            )
            VALUES (?, ?, 'depot', ?, ?, ?)
            `,
        )
        .run(companyId, name, latitude, longitude, radius);

    return Number(result.lastInsertRowid);
}

function patch(
    vehicleId: number,
    companyId: number,
    latitude: number,
    longitude: number,
) {
    return SiteModel.applyPatches([
        {
            id: vehicleId,
            company_id: companyId,
            speed: 0,
            latitude,
            longitude,
            recorded_at: "2026-04-01 08:00:00",
            fuel_level: 80,
        },
    ]);
}

let api: ReturnType<typeof request.agent>;

beforeEach(async () => {
    api = (await loginAs(1)).agent;
});

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

describe("depot geofence", () => {
    it("marks the vehicle in the nearest depot and writes no inbox row", async () => {
        insertDepot(1);
        const created = await api.post("/api/vehicles").send({
            license_plate: "K-DP 1",
            fuel_level: 80,
            status: "IDLE",
        });
        assert.equal(created.status, 201);
        const vehicleId = created.body.id as number;

        const entered = patch(vehicleId, 1, DEPOT.latitude, DEPOT.longitude);
        assert.deepEqual(entered, [1]);

        const inside = await api.get("/api/vehicles").query({ filter: "in_depot" });
        assert.equal(inside.status, 200);
        assert.deepEqual(
            inside.body.data.map((row: { id: number }) => row.id),
            [vehicleId],
        );

        const briefing = await api.get("/api/briefing");
        assert.equal(briefing.body.data.counts.in_depot, 1);

        const stillInside = patch(
            vehicleId,
            1,
            DEPOT.latitude + 0.0001,
            DEPOT.longitude,
        );
        assert.deepEqual(stillInside, []);

        const left = patch(vehicleId, 1, DEPOT.latitude + 0.05, DEPOT.longitude);
        assert.deepEqual(left, [1]);

        const outside = await api.get("/api/vehicles").query({ filter: "in_depot" });
        assert.equal(outside.body.data.length, 0);

        const inbox = await api.get("/api/alerts");
        assert.equal(inbox.status, 200);
        assert.equal(inbox.body.meta.total, 0);
        assert.equal(inbox.body.meta.type_counts.GEOFENCE, undefined);

        const rejected = await api.get("/api/alerts").query({ type: "GEOFENCE" });
        assert.equal(rejected.status, 400);
    });

    it("keeps one vehicle on the nearer center when circles overlap", async () => {
        insertDepot(1, "Nah", 50.9, 6.9, 800);
        insertDepot(1, "Fern", 50.901, 6.9, 800);
        const created = await api.post("/api/vehicles").send({
            license_plate: "K-DP 3",
            fuel_level: 80,
            status: "IDLE",
        });
        const vehicleId = created.body.id as number;

        patch(vehicleId, 1, 50.9, 6.9);

        const listed = await api.get("/api/vehicles").query({ filter: "in_depot" });
        assert.equal(listed.body.data.length, 1);

        const sites = await api.get("/api/sites");
        const near = sites.body.data.find(
            (site: { name: string }) => site.name === "Nah",
        );
        const far = sites.body.data.find(
            (site: { name: string }) => site.name === "Fern",
        );
        assert.equal(near.in_depot_count, 1);
        assert.equal(far.in_depot_count, 0);
    });

    it("ignores another company's depot", async () => {
        insertDepot(2, "Düsseldorf");
        const created = await api.post("/api/vehicles").send({
            license_plate: "K-DP 2",
            fuel_level: 80,
            status: "IDLE",
        });
        const vehicleId = created.body.id as number;

        const moved = patch(vehicleId, 1, DEPOT.latitude, DEPOT.longitude);
        assert.deepEqual(moved, []);

        const briefing = await api.get("/api/briefing");
        assert.equal(briefing.body.data.counts.in_depot, 0);
    });
});
