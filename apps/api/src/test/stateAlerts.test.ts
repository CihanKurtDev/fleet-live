import "./env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { db } from "../db/database";
import { pruneResolvedAlerts } from "../db/alertRetention";
import { noteOldAutoClosedSpeeding, syncStateAlerts } from "../db/stateAlerts";
import { ExceptionEventModel } from "../models/exceptionEvent.model";
import { UserModel } from "../models/user.model";
import { VehicleModel } from "../models/vehicle.model";
import { insertAlert, loginAs } from "./helpers";

let api: ReturnType<typeof request.agent>;

beforeEach(async () => {
    api = (await loginAs(1)).agent;
});

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

/** The controller writes the vehicle and then syncs its warnings; so does this. */
const make = (plate: string, status: "IDLE" | "OFFLINE" = "IDLE") => {
    const vehicle = VehicleModel.create({
        license_plate: plate,
        driver_name: "Test",
        company_id: 1,
        status,
        fuel_level: 80,
    });
    ExceptionEventModel.syncVehicle({ id: vehicle.id, status });

    return vehicle;
};

const rows = (vehicleId: number, type: string) =>
    db
        .prepare(
            `SELECT id, ended_at, resolved_at FROM alerts
             WHERE vehicle_id = ? AND type = ? ORDER BY id`,
        )
        .all(vehicleId, type) as Array<{
        id: number;
        ended_at: string | null;
        resolved_at: string | null;
    }>;

const daysAgo = (days: number) =>
    new Date(Date.now() - days * 86_400_000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");

describe("Kein Signal is a state warning", () => {
    it("cannot be closed by hand, single or in bulk", async () => {
        const vehicle = make("K-ST 1", "OFFLINE");
        const [offline] = rows(vehicle.id, "OFFLINE");
        assert.ok(offline, "a vehicle without signal has an open warning");

        const single = await api
            .patch(`/api/alerts/${offline.id}`)
            .send({ resolved: true });
        assert.equal(single.status, 200);
        assert.equal(single.body.resolved_at, null);

        const bulk = await api
            .patch("/api/alerts")
            .send({ ids: [offline.id], resolved: true });
        assert.equal(bulk.status, 200);
        assert.equal(bulk.body.data.resolved, 0);
        assert.equal(rows(vehicle.id, "OFFLINE")[0]?.resolved_at, null);
    });

    it("closes itself when the status is no longer OFFLINE", async () => {
        const vehicle = make("K-ST 2", "OFFLINE");

        const response = await api
            .patch(`/api/vehicles/${vehicle.id}`)
            .send({ status: "IDLE" });
        assert.equal(response.status, 200);

        const [row] = rows(vehicle.id, "OFFLINE");
        assert.ok(row?.ended_at);
        assert.equal(row.resolved_at, row.ended_at);
        assert.equal(VehicleModel.getById(vehicle.id, 1)?.active_alerts, 0);
    });

    it("is brought in line with the vehicles by the start-up sync", () => {
        const endedNeverClicked = make("K-ST 3");
        const clickedAway = make("K-ST 4", "OFFLINE");
        const noRow = make("K-ST 5", "OFFLINE");

        insertAlert(endedNeverClicked.id, {
            type: "OFFLINE",
            ended_at: "2026-01-02 00:00:00",
        });
        // Clicked away by hand while the vehicle still has no signal.
        db.prepare(
            `UPDATE alerts SET resolved_at = '2026-01-03 00:00:00', ended_at = NULL
             WHERE vehicle_id = ? AND type = 'OFFLINE'`,
        ).run(clickedAway.id);
        db.prepare(`DELETE FROM alerts WHERE vehicle_id = ?`).run(noRow.id);

        syncStateAlerts(db);

        const open = (id: number) =>
            rows(id, "OFFLINE").filter((row) => row.resolved_at === null);

        assert.equal(open(endedNeverClicked.id).length, 0);
        assert.equal(open(clickedAway.id).length, 1);
        assert.equal(open(noRow.id).length, 1);
        assert.equal(VehicleModel.getById(endedNeverClicked.id, 1)?.active_alerts, 0);
        assert.equal(VehicleModel.getById(clickedAway.id, 1)?.active_alerts, 1);

        const before = (
            db.prepare("SELECT COUNT(*) AS n FROM alerts").get() as { n: number }
        ).n;
        syncStateAlerts(db);
        const after = (
            db.prepare("SELECT COUNT(*) AS n FROM alerts").get() as { n: number }
        ).n;
        assert.equal(after, before);
    });
});

describe("Tempo warnings stay open until someone handles them", () => {
    it("does not close an ended warning, however old, and it stays on the driver", async () => {
        const vehicle = make("K-ST 6");
        const driver = await api.post("/api/drivers").send({ name: "Tempo Test" });
        assert.equal(driver.status, 201);
        const driverId = driver.body.data.id as number;
        const old = insertAlert(vehicle.id, {
            type: "SPEEDING",
            driver_id: driverId,
            created_at: daysAgo(30),
            ended_at: daysAgo(29),
        });

        syncStateAlerts(db);
        noteOldAutoClosedSpeeding(db);
        pruneResolvedAlerts(db);

        const listed = await api.get("/api/alerts?filter=open&type=SPEEDING");
        assert.ok(listed.body.data.some((row: { id: number }) => row.id === old));
        const open = await api.get(`/api/drivers/${driverId}`);
        assert.equal(open.body.data.open_warnings, 1);
    });

    it("says on the rows the old rule closed that nobody handled them", async () => {
        const vehicle = make("K-ST 7");
        const ended = daysAgo(20);
        const plus7 = (
            db.prepare("SELECT datetime(?, '+7 days') AS t").get(ended) as { t: string }
        ).t;
        const auto = insertAlert(vehicle.id, {
            type: "SPEEDING",
            created_at: daysAgo(21),
            ended_at: ended,
            resolved_at: plus7,
        });
        const byHand = insertAlert(vehicle.id, {
            type: "SPEEDING",
            created_at: daysAgo(21),
            ended_at: ended,
            resolved_at: daysAgo(19),
        });

        noteOldAutoClosedSpeeding(db);

        const rowsNow = (await api.get(`/api/alerts?filter=resolved&vehicle_id=${vehicle.id}`)).body.data as Array<{
            id: number;
            resolution_note: string | null;
        }>;
        assert.match(rowsNow.find((row) => row.id === auto)?.resolution_note ?? "", /alte Regel/);
        assert.equal(rowsNow.find((row) => row.id === byHand)?.resolution_note, null);
    });
});

describe("resolved warnings are deleted after 90 days", () => {
    const history = async (month: string) => {
        const response = await api.get("/api/briefing");
        assert.equal(response.status, 200);

        return (
            response.body.data.history as Array<{ month: string } & Record<string, number>>
        ).find((row) => row.month === month);
    };

    it("keeps the month sums of the Schicht charts, and everything not yet due", async () => {
        const vehicle = make("K-RT 1");
        const first = await api.post("/api/drivers").send({ name: "Fahrer RT 1" });
        const second = await api.post("/api/drivers").send({ name: "Fahrer RT 2" });
        const driverA = first.body.data.id as number;
        const driverB = second.body.data.id as number;

        const created = daysAgo(120);
        const month = created.slice(0, 7);
        const old = (input: Parameters<typeof insertAlert>[1]) =>
            insertAlert(vehicle.id, {
                created_at: created,
                ended_at: daysAgo(119),
                resolved_at: daysAgo(100),
                ...input,
            });

        old({ type: "SPEEDING", severity: "HIGH", driver_id: driverA });
        old({ type: "SPEEDING", severity: "MEDIUM", driver_id: driverA });
        old({ type: "SPEEDING", severity: "MEDIUM", driver_id: driverB });
        old({ type: "LOW_FUEL" });
        old({ type: "OFFLINE" });
        // Created long ago, resolved recently: not due yet.
        const recentlyResolved = old({
            type: "SPEEDING",
            driver_id: driverA,
            resolved_at: daysAgo(10),
        });
        // Created long ago, still open: never deleted.
        const stillOpen = old({ type: "OFFLINE", resolved_at: null, ended_at: null });

        const before = await history(month);
        assert.equal(before?.speeding_events, 4);
        assert.equal(before?.speeding_drivers, 2);
        assert.equal(before?.speeding_high, 2);

        assert.equal(pruneResolvedAlerts(db), 5);

        const exists = (id: number) =>
            db.prepare("SELECT 1 FROM alerts WHERE id = ?").get(id) !== undefined;
        assert.ok(exists(recentlyResolved));
        assert.ok(exists(stillOpen));
        assert.deepEqual(await history(month), before);
        assert.equal(pruneResolvedAlerts(db), 0);
    });
});
