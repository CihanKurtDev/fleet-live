import "./env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import {
    VEHICLE_STATUS_FILTER,
    VEHICLE_STATUSES,
    type VehicleStatus,
} from "@fleet-live/shared";
import { UserModel } from "../models/user.model";
import { VehicleModel } from "../models/vehicle.model";
import { giveCurrentDriver, loginAs } from "./helpers";

let api: ReturnType<typeof request.agent>;

beforeEach(async () => {
    api = (await loginAs(1)).agent;
});

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

/** A fleet that touches every concept, written the way the app writes it. */
async function buildFleet() {
    const make = async (plate: string, status: VehicleStatus, fuel: number) => {
        const response = await api.post("/api/vehicles").send({
            license_plate: plate,
            status: status === "DRIVING" ? "IDLE" : status,
            fuel_level: fuel,
        });
        assert.equal(response.status, 201, JSON.stringify(response.body));
        const id = response.body.data?.id ?? response.body.id;

        if (status === "DRIVING") {
            await giveCurrentDriver(api, id, `Fahrer ${plate}`);
            const driving = await api.patch(`/api/vehicles/${id}`).send({ status });
            assert.equal(driving.status, 200, JSON.stringify(driving.body));
        }

        return id as number;
    };

    await make("K-CC 1", "DRIVING", 80);
    await make("K-CC 2", "DRIVING", 10);
    await make("K-CC 3", "IDLE", 14);
    await make("K-CC 4", "IDLE", 15);
    await make("K-CC 5", "STOPPED", 60);
    await make("K-CC 6", "STOPPED", 3);
    await make("K-CC 7", "OFFLINE", 50);
    await make("K-CC 8", "OFFLINE", 5);
}

describe("one definition for every number", () => {
    it("shows the same counts on the vehicle list and on Schicht", async () => {
        await buildFleet();

        const list = await api.get("/api/vehicles").query({ limit: 1 });
        const briefing = await api.get("/api/briefing");
        const counts = list.body.meta.counts;
        const schicht = briefing.body.data.counts;

        for (const key of [
            "driving",
            "idle",
            "stopped",
            "offline",
            "low_fuel",
            "in_depot",
            "speeding",
        ] as const) {
            assert.equal(schicht[key], counts[key], key);
        }
    });

    it("lets the four statuses add up to every vehicle", async () => {
        await buildFleet();

        const list = await api.get("/api/vehicles").query({ limit: 1 });
        const counts = list.body.meta.counts;
        const sum = VEHICLE_STATUSES.reduce(
            (total, status) => total + counts[VEHICLE_STATUS_FILTER[status]],
            0,
        );

        assert.equal(sum, counts.all);
    });

    it("lets each count be the total of its own filter", async () => {
        await buildFleet();

        const base = await api.get("/api/vehicles").query({ limit: 1 });

        for (const filter of [
            "driving",
            "idle",
            "stopped",
            "offline",
            "low_fuel",
        ] as const) {
            const filtered = await api
                .get("/api/vehicles")
                .query({ limit: 1, filter });
            assert.equal(
                filtered.body.meta.total,
                base.body.meta.counts[filter],
                filter,
            );
        }
    });

    it("shows the same vehicles as warnings for Wenig Tank and Kein Signal", async () => {
        await buildFleet();

        const briefing = await api.get("/api/briefing");
        const schicht = briefing.body.data.counts;

        const fuel = await api
            .get("/api/alerts")
            .query({ type: "LOW_FUEL", filter: "open", limit: 1 });
        const funk = await api
            .get("/api/alerts")
            .query({ type: "OFFLINE", filter: "open", limit: 1 });

        assert.equal(fuel.body.meta.total, schicht.low_fuel);
        assert.equal(funk.body.meta.total, schicht.offline);
        assert.equal(schicht.low_fuel, 4);
        assert.equal(schicht.offline, 2);
    });

    it("counts the same status on the map density as on the list", async () => {
        await buildFleet();

        const list = await api.get("/api/vehicles").query({ limit: 1 });
        const positions = await api.get("/api/vehicles/positions");

        assert.equal(positions.status, 200);
        assert.ok(
            positions.body.meta.total <= list.body.meta.counts.all,
            "the map shows vehicles with a position, never more than the fleet",
        );
    });
});
