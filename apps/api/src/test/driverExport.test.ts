import "./env";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import request from "supertest";
import { strFromU8, unzipSync } from "fflate";
import { encodePolyline } from "@fleet-live/shared";
import { app } from "../app";
import { db } from "../db/database";
import { UserModel } from "../models/user.model";
import { VehicleModel } from "../models/vehicle.model";
import { insertAlert, loginAs } from "./helpers";

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

function driver(name: string, companyId: number, phone: string | null = null): number {
    const result = db
        .prepare("INSERT INTO drivers (company_id, name, phone, licence_expires_on) VALUES (?, ?, ?, '2027-05-31')")
        .run(companyId, name, phone);
    return Number(result.lastInsertRowid);
}

function trip(vehicleId: number, driverId: number, startedAt: string) {
    const path = encodePolyline([
        { lat: 50.9375, lng: 6.9603 },
        { lat: 50.9413, lng: 6.9583 },
    ]);
    const result = db
        .prepare(
            "INSERT INTO trips (vehicle_id, driver_id, started_at, ended_at, path, distance_m, max_speed) VALUES (?, ?, ?, ?, ?, 4200, 71)",
        )
        .run(vehicleId, driverId, startedAt, startedAt, path);
    return Number(result.lastInsertRowid);
}

async function zipOf(response: request.Response) {
    return unzipSync(new Uint8Array(response.body as Buffer));
}

function binary(res: request.Response, callback: (error: Error | null, body: Buffer) => void) {
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () => callback(null, Buffer.concat(chunks)));
}

describe("the Auskunft about a driver", () => {
    it("holds the driver's data and nobody else's", async () => {
        const { agent } = await loginAs(1);
        const ada = driver("Ada Lovelace", 1, "0221 123");
        const bob = driver("Bob", 1);
        const van = VehicleModel.create({ license_plate: "K-AU 1", company_id: 1 });
        db.prepare("INSERT INTO driver_vehicles (driver_id, vehicle_id) VALUES (?, ?)").run(ada, van.id);
        const mine = trip(van.id, ada, "2026-10-20 08:00:00");
        trip(van.id, bob, "2026-10-21 08:00:00");
        db.prepare(
            "INSERT INTO trip_events (trip_id, type, started_at, from_m, to_m, max_speed_kmh, limit_kmh) VALUES (?, 'SPEEDING', '2026-10-20 08:10:00', 700, 4800, 71, 50)",
        ).run(mine);
        insertAlert(van.id, { driver_id: ada, message: "zu schnell", ended_at: "2026-10-20 08:11:00", resolved_at: "2026-10-20 09:00:00" });
        insertAlert(van.id, { driver_id: bob, message: "Bob zu schnell" });

        const response = await agent
            .get(`/api/export/drivers/${ada}`)
            .buffer(true)
            .parse(binary)
            .expect(200);
        assert.equal(response.headers["content-type"], "application/zip");
        assert.match(String(response.headers["content-disposition"]), /filename="auskunft-ada-lovelace\.zip"/);

        const files = await zipOf(response);
        assert.deepEqual(Object.keys(files).sort(), [
            "ereignisse.csv",
            "fahrten.csv",
            "fahrzeuge.csv",
            "liesmich.txt",
            "stammdaten.csv",
            "warnungen.csv",
            "wege.geojson",
        ]);
        const text = (name: string) => strFromU8(files[name] as Uint8Array);
        assert.match(text("stammdaten.csv"), /Ada Lovelace;0221 123;2027-05-31/);
        assert.match(text("fahrzeuge.csv"), /K-AU 1;Ja;Nein/);
        assert.equal(text("fahrten.csv").trim().split("\r\n").length, 2);
        assert.match(text("ereignisse.csv"), /Zu schnell/);
        assert.equal(text("warnungen.csv").trim().split("\r\n").length, 2);
        assert.doesNotMatch(text("warnungen.csv"), /Bob/);

        const routes = JSON.parse(text("wege.geojson"));
        assert.equal(routes.features.length, 1);
        assert.deepEqual(routes.features[0].geometry.coordinates[0], [6.9603, 50.9375]);
        assert.match(text("liesmich.txt"), /Ada Lovelace/);

        const log = await agent.get("/api/auth/audit").expect(200);
        assert.equal(log.body.data[0].action, "driver_exported");
        assert.deepEqual(log.body.data[0].details, { driver: "Ada Lovelace" });
    });

    it("is for dispatchers of the driver's company", async () => {
        const other = driver("Fremd", 2);
        const { agent } = await loginAs(1);
        await agent.get(`/api/export/drivers/${other}`).expect(404);
        await agent.get("/api/export/drivers/abc").expect(404);

        const own = driver("Eigen", 1);
        const { agent: viewer } = await loginAs(1, "viewer");
        await viewer.get(`/api/export/drivers/${own}`).expect(403);
        await request(app).get(`/api/export/drivers/${own}`).expect(401);
    });
});
