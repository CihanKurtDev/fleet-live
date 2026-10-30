import "./env";
import assert from "node:assert/strict";
import { importActionKey, parseKilometerText, type ImportPreviewRow } from "@fleet-live/shared";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { resetImportPreviewStoreForTests } from "../lib/importPreviewStore";
import { ImportModel } from "../models/import.model";
import { TelemetryModel } from "../models/telemetry.model";
import { UserModel } from "../models/user.model";
import { VehicleModel } from "../models/vehicle.model";
import { resetSimProgress, seedSimProgress } from "../sim/routes";
import { giveCurrentDriver, loginAs } from "./helpers";

let api: ReturnType<typeof request.agent>;

async function create(plate: string, odometer?: number) {
    const response = await api.post("/api/vehicles").send({
        license_plate: plate,
        fuel_level: 80,
        status: "IDLE",
        ...(odometer === undefined ? {} : { odometer_km: odometer }),
    });
    assert.equal(response.status, 201);
    return response.body as { id: number; odometer_km: number | null };
}

const reading = async (vehicleId: number) =>
    (await api.get(`/api/vehicles/${vehicleId}/odometer`)).body.data as {
        km: number | null;
        readings: Array<{
            km: number;
            previous_km: number | null;
            source: string;
            note: string | null;
            actor_name: string | null;
        }>;
    };

beforeEach(async () => {
    api = (await loginAs(1)).agent;
});

afterEach(() => {
    resetSimProgress();
    ImportModel.resetForTests();
    resetImportPreviewStoreForTests();
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

describe("kilometre figures as people write them", () => {
    it("reads plain numbers, thousands groups and spreadsheet decimals", () => {
        assert.equal(parseKilometerText("123456"), 123456);
        assert.equal(parseKilometerText(" 123.456 "), 123456);
        assert.equal(parseKilometerText("1.234.567"), 1234567);
        assert.equal(parseKilometerText("123 456"), 123456);
        assert.equal(parseKilometerText("45210,7"), 45210);
        assert.equal(parseKilometerText("45210.75"), 45210);
        assert.equal(parseKilometerText(""), null);
        assert.equal(parseKilometerText("12a"), "invalid");
        assert.equal(parseKilometerText("-5"), "invalid");
    });
});

describe("odometer", () => {
    it("requires a session", async () => {
        assert.equal((await request(app).get("/api/vehicles/1/odometer")).status, 401);
    });

    it("starts with the reading entered at create and logs it", async () => {
        const car = await create("K-KM 1", 12345);
        assert.equal(car.odometer_km, 12345);

        const odometer = await reading(car.id);
        assert.equal(odometer.km, 12345);
        assert.equal(odometer.readings.length, 1);
        assert.deepEqual(
            {
                km: odometer.readings[0]?.km,
                previous: odometer.readings[0]?.previous_km,
                source: odometer.readings[0]?.source,
                by: odometer.readings[0]?.actor_name,
            },
            { km: 12345, previous: null, source: "CREATE", by: "dispatcher 1" },
        );

        const unknown = await create("K-KM 2");
        assert.equal(unknown.odometer_km, null);
        assert.deepEqual(await reading(unknown.id), { km: null, readings: [] });
    });

    it("grows by the distance of a trip", async () => {
        const car = await create("K-KM 3", 1000);
        const unknown = await create("K-KM 4");
        await giveCurrentDriver(api, car.id);
        await giveCurrentDriver(api, unknown.id);
        await api.patch(`/api/vehicles/${car.id}`).send({ status: "DRIVING" }).expect(200);
        await api.patch(`/api/vehicles/${unknown.id}`).send({ status: "DRIVING" }).expect(200);
        seedSimProgress(car.id, "koeln-duesseldorf", 0.2);
        seedSimProgress(unknown.id, "koeln-duesseldorf", 0.5);

        for (let index = 0; index < 20; index += 1) {
            TelemetryModel.tickDrivingVehicles([car.id, unknown.id]);
        }

        await api.patch(`/api/vehicles/${car.id}`).send({ status: "IDLE" }).expect(200);

        const trips = (await api.get(`/api/vehicles/${car.id}/trips`)).body.data as Array<{
            distance_m: number;
        }>;
        const driven = trips.reduce((sum, trip) => sum + trip.distance_m, 0);
        assert.ok(driven > 2000, `drove ${driven} m`);

        const after = (await api.get(`/api/vehicles/${car.id}`)).body;
        assert.equal(after.odometer_km, Math.floor((1000 * 1000 + driven) / 1000));
        // Driving adds no reading to the history; only people and the import do.
        assert.equal((await reading(car.id)).readings.length, 1);
        // Without a reading there is nothing to add to.
        assert.equal((await api.get(`/api/vehicles/${unknown.id}`)).body.odometer_km, null);
    });

    it("is corrected by hand with a reason and keeps the history", async () => {
        const car = await create("K-KM 5", 12345);

        const corrected = await api
            .post(`/api/vehicles/${car.id}/odometer`)
            .send({ km: 50000, note: " Werkstattrechnung " });
        assert.equal(corrected.status, 200);
        assert.equal(corrected.body.data.km, 50000);
        assert.deepEqual(
            {
                km: corrected.body.data.readings[0].km,
                previous: corrected.body.data.readings[0].previous_km,
                source: corrected.body.data.readings[0].source,
                note: corrected.body.data.readings[0].note,
            },
            { km: 50000, previous: 12345, source: "MANUAL", note: "Werkstattrechnung" },
        );
        assert.equal(corrected.body.data.readings.length, 2);
        assert.equal((await api.get(`/api/vehicles/${car.id}`)).body.odometer_km, 50000);

        const same = await api.post(`/api/vehicles/${car.id}/odometer`).send({ km: 50000 });
        assert.equal(same.status, 400);
        assert.ok(same.body.fields.km);

        for (const km of [-5, 1.5, "abc", 3_000_000]) {
            const wrong = await api.post(`/api/vehicles/${car.id}/odometer`).send({ km });
            assert.equal(wrong.status, 400, String(km));
            assert.ok(wrong.body.fields.km, String(km));
        }
    });

    it("is not changed by a vehicle update, so no reading bypasses the history", async () => {
        const car = await create("K-KM 6", 100);

        const patched = await api.patch(`/api/vehicles/${car.id}`).send({ odometer_km: 200 });
        assert.equal(patched.status, 400);
        assert.ok(patched.body.fields.odometer_km);

        const invalid = await api.post("/api/vehicles").send({
            license_plate: "K-KM 7",
            fuel_level: 50,
            status: "IDLE",
            odometer_km: -1,
        });
        assert.equal(invalid.status, 400);
        assert.ok(invalid.body.fields.odometer_km);
    });

    it("keeps other companies out and viewers read-only", async () => {
        const car = await create("K-KM 8", 10);
        const foreign = VehicleModel.create({ company_id: 2, license_plate: "B-FREMD 8" });

        assert.equal((await api.get(`/api/vehicles/${foreign.id}/odometer`)).status, 404);
        assert.equal(
            (await api.post(`/api/vehicles/${foreign.id}/odometer`).send({ km: 5 })).status,
            404,
        );

        const viewer = (await loginAs(1, "viewer")).agent;
        assert.equal((await viewer.get(`/api/vehicles/${car.id}/odometer`)).status, 200);
        assert.equal(
            (await viewer.post(`/api/vehicles/${car.id}/odometer`).send({ km: 20 })).status,
            403,
        );
    });

    it("comes from the import: new vehicles start with it, a changed figure is logged", async () => {
        const preview = async (csv: string) => {
            const response = await api.post("/api/import/preview").send({ csv }).expect(200);
            const rows = (
                await api
                    .get(`/api/import/preview/${response.body.data.preview_id}/rows`)
                    .query({ limit: 100 })
                    .expect(200)
            ).body.data as ImportPreviewRow[];
            return { id: response.body.data.preview_id as string, rows };
        };

        const first = await preview(`Kennzeichen;Tank;Status;Kilometerstand
B-IMP 1;80;Standby;123.456
B-IMP 2;80;Standby;12a
`);
        assert.equal(first.rows.find((row) => row.license_plate === "B-IMP 1")?.odometer_km, 123456);
        const bad = first.rows.find((row) => row.license_plate === "B-IMP 2");
        assert.equal(bad?.issues.some((issue) => issue.code === "INVALID_ODOMETER"), true);
        assert.equal(bad?.default_action, "skip");

        await api.post("/api/import/commit").send({ preview_id: first.id }).expect(200);
        const vehicles = (await api.get("/api/vehicles").query({ search: "B-IMP" })).body.data as Array<{
            id: number;
            license_plate: string;
            odometer_km: number | null;
        }>;
        const imported = vehicles.find((vehicle) => vehicle.license_plate === "B-IMP 1");
        assert.ok(imported);
        assert.equal(imported.odometer_km, 123456);
        assert.equal((await reading(imported.id)).readings[0]?.source, "IMPORT");

        const update = async (km: string) => {
            const next = await preview(`Kennzeichen;Tank;Status;Kilometerstand
B-IMP 1;80;Standby;${km}
`);
            const row = next.rows[0]!;
            await api
                .post("/api/import/commit")
                .send({
                    preview_id: next.id,
                    row_actions: { [importActionKey("vehicles", row.row_index)]: "update" },
                })
                .expect(200);
        };

        await update("123456");
        assert.equal((await reading(imported.id)).readings.length, 1);

        await update("130000");
        const after = await reading(imported.id);
        assert.equal(after.km, 130000);
        assert.equal(after.readings.length, 2);
        assert.equal(after.readings[0]?.previous_km, 123456);
    });
});
