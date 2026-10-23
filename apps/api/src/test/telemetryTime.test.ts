import "./env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import {
    compactTelemetryPatches,
    expandTelemetryPatches,
    parseRecordedAt,
} from "@fleet-live/shared";
import { TelemetryModel } from "../models/telemetry.model";
import { UserModel } from "../models/user.model";
import { VehicleModel } from "../models/vehicle.model";
import { seedSimProgress } from "../sim/routes";
import { loginAs } from "./helpers";

describe("parseRecordedAt", () => {
    it("reads the stored format with and without milliseconds as UTC", () => {
        assert.equal(
            parseRecordedAt("2026-10-23 10:00:05"),
            Date.UTC(2026, 9, 23, 10, 0, 5),
        );
        assert.equal(
            parseRecordedAt("2026-10-23 10:00:05.250"),
            Date.UTC(2026, 9, 23, 10, 0, 5, 250),
        );
        // Finer device clocks are cut to the millisecond, not rounded up.
        assert.equal(
            parseRecordedAt("2026-10-23 10:00:05.123987"),
            Date.UTC(2026, 9, 23, 10, 0, 5, 123),
        );
        assert.equal(
            parseRecordedAt("2026-10-23T10:00:05.5Z"),
            Date.UTC(2026, 9, 23, 10, 0, 5, 500),
        );
    });

    it("rejects what is not a timestamp of the contract instead of guessing", () => {
        for (const value of [
            "",
            "1761213605",
            "1761213605000",
            "2026-13-01 00:00:00",
            "2026-02-30 00:00:00",
            "2026-10-23 24:00:00",
            "2026-10-23 10:00",
            "2026-10-23 10:00:05+02:00",
            "2026-10-23 10:00:05.1234567",
        ]) {
            assert.equal(parseRecordedAt(value), null, value);
        }
    });
});

describe("telemetry device time", () => {
    let api: ReturnType<typeof request.agent>;

    beforeEach(async () => {
        api = (await loginAs(1)).agent;
    });

    afterEach(() => {
        VehicleModel.resetForTests();
        UserModel.resetForTests();
    });

    it("stamps each ping in milliseconds, so the map can time a 3–8 s gap", async () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-MS 1",
            driver_name: "Takt",
            status: "DRIVING",
        });
        seedSimProgress(vehicle.id, "koeln-duesseldorf", 0.2);

        const [first] = TelemetryModel.tickDrivingVehicles([vehicle.id]);
        const [second] = TelemetryModel.tickDrivingVehicles([vehicle.id]);

        assert.ok(first && second);
        assert.match(first.recorded_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
        assert.ok(parseRecordedAt(second.recorded_at)! >= parseRecordedAt(first.recorded_at)!);

        const history = await api
            .get(`/api/vehicles/${vehicle.id}/telemetry`)
            .query({ limit: 10 });

        assert.equal(history.status, 200);
        const stamps = (history.body.data as { recorded_at: string }[]).map(
            (point) => point.recorded_at,
        );
        // Oldest first, and the newest row is the last ping as streamed.
        assert.equal(stamps[stamps.length - 1], second.recorded_at);
        assert.deepEqual([...stamps].sort(), stamps);
    });

    it("keeps the milliseconds over the wire", () => {
        const patches = [
            { id: 1, speed: 50, latitude: 50, longitude: 7, fuel_level: 80, recorded_at: "2026-10-23 10:00:05.250" },
            { id: 2, speed: 50, latitude: 50, longitude: 7, fuel_level: 80, recorded_at: "2026-10-23 10:00:05.250" },
            { id: 3, speed: 50, latitude: 50, longitude: 7, fuel_level: 80, recorded_at: "2026-10-23 10:00:06.900" },
        ];
        const restored = expandTelemetryPatches(
            compactTelemetryPatches(patches) as Parameters<typeof expandTelemetryPatches>[0],
        );

        assert.deepEqual(
            restored?.map((patch) => patch.recorded_at),
            patches.map((patch) => patch.recorded_at),
        );
    });
});
