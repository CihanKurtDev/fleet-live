import "./env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { UserModel } from "../models/user.model";
import { VehicleModel } from "../models/vehicle.model";
import { loginAs } from "./helpers";

let api: ReturnType<typeof request.agent>;

beforeEach(async () => {
    api = (await loginAs(1)).agent;
});

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

const make = (plate: string, driver: string) =>
    VehicleModel.create({
        license_plate: plate,
        driver_name: driver,
        company_id: 1,
        status: "IDLE",
        fuel_level: 50,
    });

describe("GET /api/vehicles/positions driver_search", () => {
    it("filters by a text in the driver's name or in the plate, with no list of names", async () => {
        const anna = make("K-DS 1", "Anna Testmann");
        const bernd = make("K-DS 2", "Bernd Testmann");
        const clara = make("K-XY 3", "Clara Andere");

        const byName = await api
            .get("/api/vehicles/positions")
            .query({ driver_search: "testmann" });
        assert.equal(byName.status, 200);
        assert.equal(byName.body.meta.matched, 2);

        const byPlate = await api
            .get("/api/vehicles/positions")
            .query({ driver_search: "k-xy" });
        assert.equal(byPlate.body.meta.matched, 1);

        const none = await api
            .get("/api/vehicles/positions")
            .query({ driver_search: "gibtesnicht" });
        assert.equal(none.body.meta.matched, 0);

        const all = await api.get("/api/vehicles/positions");
        assert.ok(all.body.meta.matched >= 3);
        void anna;
        void bernd;
        void clara;
    });

    it("treats % and _ as plain characters", async () => {
        make("K-DS 4", "Dora 100%");
        make("K-DS 5", "Dora 1000");

        const response = await api
            .get("/api/vehicles/positions")
            .query({ driver_search: "100%" });

        assert.equal(response.body.meta.matched, 1);
    });

    it("stays inside the company", async () => {
        const other = VehicleModel.create({
            license_plate: "K-DS 9",
            driver_name: "Fremde Firma",
            company_id: 2,
            status: "IDLE",
            fuel_level: 50,
        });
        void other;

        const response = await api
            .get("/api/vehicles/positions")
            .query({ driver_search: "fremde" });

        assert.equal(response.body.meta.matched, 0);
    });

    it("rejects a search that is too long", async () => {
        const response = await api
            .get("/api/vehicles/positions")
            .query({ driver_search: "a".repeat(101) });

        assert.equal(response.status, 400);
    });
});
