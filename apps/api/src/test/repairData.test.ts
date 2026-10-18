import "./env";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { db } from "../db/database";
import { repairData, type RepairResult } from "../db/repairData";
import { insertAlert } from "./helpers";
import { SiteModel } from "../models/site.model";
import { TripModel } from "../models/trip.model";
import { VehicleModel } from "../models/vehicle.model";

afterEach(() => {
    VehicleModel.resetForTests();
});

const state = (plate: string) =>
    db
        .prepare(
            `SELECT v.id, v.status, v.current_driver_id, v.depot_site_id,
                    (SELECT COUNT(*) FROM trips t
                       WHERE t.vehicle_id = v.id AND t.ended_at IS NULL) AS open_trips,
                    (SELECT COUNT(*) FROM alerts a
                       WHERE a.vehicle_id = v.id AND a.type = 'OFFLINE'
                         AND a.ended_at IS NULL) AS open_offline
             FROM vehicles v WHERE v.license_plate = ?`,
        )
        .get(plate) as {
        id: number;
        status: string;
        current_driver_id: number | null;
        depot_site_id: number | null;
        open_trips: number;
        open_offline: number;
    };

const rule = (result: RepairResult, id: string) =>
    result.rules.find((entry) => entry.id === id)!;

function setup() {
    const ghost = VehicleModel.create({
        license_plate: "K-GH 1",
        status: "DRIVING",
        company_id: 1,
    });
    const otherCompany = VehicleModel.create({
        license_plate: "K-GH 2",
        status: "DRIVING",
        company_id: 2,
    });
    const withDriver = VehicleModel.create({
        license_plate: "K-OK 1",
        driver_name: "Mit Fahrer",
        status: "DRIVING",
        company_id: 1,
    });
    const tripless = VehicleModel.create({
        license_plate: "K-NT 1",
        driver_name: "Ohne Fahrt",
        status: "DRIVING",
        company_id: 1,
    });
    const idle = VehicleModel.create({
        license_plate: "K-ID 1",
        status: "IDLE",
        company_id: 1,
    });
    const silent = VehicleModel.create({
        license_plate: "K-SI 1",
        status: "OFFLINE",
        company_id: 1,
    });

    for (const vehicle of [ghost, otherCompany, withDriver]) {
        TripModel.open(vehicle.id);
    }

    return { ghost, otherCompany, withDriver, tripless, idle, silent };
}

describe("repairData: a vehicle only drives with a driver", () => {
    it("reports what it would change and writes nothing on a dry run", () => {
        setup();

        const result = repairData({ dryRun: true });

        assert.equal(result.dryRun, true);
        assert.equal(rule(result, "driving_without_driver").count, 2);
        assert.deepEqual(
            rule(result, "driving_without_driver").examples,
            ["K-GH 1", "K-GH 2"],
        );
        assert.equal(state("K-GH 1").status, "DRIVING");
        assert.equal(state("K-GH 1").open_trips, 1);
        assert.equal(state("K-NT 1").open_trips, 0);
        assert.equal(state("K-SI 1").open_offline, 0);
    });

    it("sets driverless DRIVING vehicles to IDLE and closes their trip, nothing else", () => {
        setup();

        const result = repairData();

        assert.equal(rule(result, "driving_without_driver").count, 2);

        for (const plate of ["K-GH 1", "K-GH 2"]) {
            assert.equal(state(plate).status, "IDLE");
            assert.equal(state(plate).open_trips, 0);
        }

        const kept = state("K-OK 1");
        assert.equal(kept.status, "DRIVING");
        assert.notEqual(kept.current_driver_id, null);
        assert.equal(kept.open_trips, 1);
        assert.equal(state("K-ID 1").status, "IDLE");

        const left = db
            .prepare(
                `SELECT COUNT(*) AS c FROM vehicles
                 WHERE status = 'DRIVING' AND current_driver_id IS NULL`,
            )
            .get() as { c: number };
        assert.equal(left.c, 0);
    });

    it("limits itself to one company and finds nothing the second time", () => {
        setup();

        const only = repairData({ companyId: 1 });

        assert.equal(rule(only, "driving_without_driver").count, 1);
        assert.equal(state("K-GH 1").status, "IDLE");
        assert.equal(state("K-GH 2").status, "DRIVING");

        repairData();
        assert.equal(repairData().total, 0);
    });
});

describe("repairData: other states the rules do not allow", () => {
    it("opens the trip of a DRIVING vehicle that has none", () => {
        setup();

        const result = repairData();

        // Das Fahrzeug ohne Fahrer wird Standby, nicht „Fahrt eröffnet“.
        assert.equal(rule(result, "driving_without_trip").count, 1);
        assert.deepEqual(rule(result, "driving_without_trip").examples, ["K-NT 1"]);
        assert.equal(state("K-NT 1").open_trips, 1);
        assert.equal(state("K-OK 1").open_trips, 1);
    });

    it("opens the missing OFFLINE warning with the time of the last report", () => {
        const { silent } = setup();

        db.prepare(
            `INSERT INTO telemetry (vehicle_id, latitude, longitude, speed, recorded_at)
             VALUES (?, 50.9, 6.9, 0, '2026-10-01 08:00:00')`,
        ).run(silent.id);

        const result = repairData();

        assert.equal(rule(result, "offline_without_warning").count, 1);
        assert.equal(state("K-SI 1").open_offline, 1);

        const alert = db
            .prepare(
                `SELECT created_at, severity FROM alerts WHERE vehicle_id = ? AND type = 'OFFLINE'`,
            )
            .get(silent.id) as { created_at: string; severity: string };

        assert.equal(alert.created_at, "2026-10-01 08:00:15");
        assert.equal(alert.severity, "HIGH");
        assert.equal(repairData().total, 0);
    });

    it("never lets a warning end or be resolved before it began", () => {
        const { idle } = setup();
        const alertId = insertAlert(idle.id, {
            type: "SPEEDING",
            created_at: "2026-10-12 13:55:00",
            ended_at: "2026-10-12 14:05:47",
            resolved_at: "2026-10-05 15:26:37",
        });
        const endedEarly = insertAlert(idle.id, {
            type: "LOW_FUEL",
            created_at: "2026-10-12 13:55:00",
            ended_at: "2026-10-01 00:00:00",
        });

        const result = repairData();

        assert.equal(rule(result, "alerts_out_of_order").count, 2);

        const row = (id: number) =>
            db
                .prepare(`SELECT created_at, ended_at, resolved_at FROM alerts WHERE id = ?`)
                .get(id) as { created_at: string; ended_at: string | null; resolved_at: string | null };

        assert.equal(row(alertId).ended_at, "2026-10-12 14:05:47");
        // Erledigt wird nicht vor dem Ende der Warnung angesetzt.
        assert.equal(row(alertId).resolved_at, "2026-10-12 14:05:47");
        assert.equal(row(endedEarly).ended_at, "2026-10-12 13:55:00");
        assert.equal(repairData().total, 0);
    });

    it("puts a vehicle into the depot it stands in", () => {
        const { idle } = setup();
        const site = SiteModel.create(1, {
            name: "Test Hof",
            latitude: 50.9,
            longitude: 6.9,
            radius_m: 800,
        });

        db.prepare(
            `INSERT INTO telemetry (vehicle_id, latitude, longitude, speed)
             VALUES (?, 50.9001, 6.9001, 0)`,
        ).run(idle.id);
        db.prepare(`UPDATE vehicles SET depot_site_id = NULL WHERE id = ?`).run(idle.id);

        const dry = repairData({ dryRun: true });
        assert.ok(rule(dry, "depot_presence").examples.includes("K-ID 1"));
        assert.equal(state("K-ID 1").depot_site_id, null);

        repairData();
        assert.equal(state("K-ID 1").depot_site_id, site.id);
    });
});
