import "./env";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { UserModel } from "../models/user.model";
import { VehicleModel } from "../models/vehicle.model";
import { loginAs } from "./helpers";

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

describe("depots", () => {
    it("requires a session", async () => {
        const response = await request(app).get("/api/sites");
        assert.equal(response.status, 401);
    });

    it("lets a viewer read and blocks writes", async () => {
        const { agent } = await loginAs(1, "viewer");
        const listed = await agent.get("/api/sites");
        assert.equal(listed.status, 200);
        assert.deepEqual(listed.body.data, []);

        const created = await agent.post("/api/sites").send({
            name: "Köln",
            latitude: 50.9,
            longitude: 6.9,
        });
        assert.equal(created.status, 403);
    });

    it("creates, assigns a home depot, and clears it on delete", async () => {
        const { agent } = await loginAs(1);
        const created = await agent.post("/api/sites").send({
            name: "Köln",
            latitude: 50.9375,
            longitude: 6.9603,
        });
        assert.equal(created.status, 201);
        assert.equal(created.body.radius_m, 800);
        assert.equal(created.body.home_count, 0);

        const vehicle = await agent.post("/api/vehicles").send({
            license_plate: "K-HOME 1",
            fuel_level: 70,
            status: "IDLE",
            home_site_id: created.body.id,
        });
        assert.equal(vehicle.status, 201);
        assert.equal(vehicle.body.home_site_id, created.body.id);
        assert.equal(vehicle.body.depot, "Köln");

        const listed = await agent.get("/api/sites");
        assert.equal(listed.body.data[0].home_count, 1);
        assert.equal(listed.body.data[0].in_depot_count, 0);

        const duplicate = await agent.post("/api/sites").send({
            name: "Köln",
            latitude: 51,
            longitude: 7,
        });
        assert.equal(duplicate.status, 409);

        const tooSmall = await agent.post("/api/sites").send({
            name: "Winzig",
            latitude: 51,
            longitude: 7,
            radius_m: 50,
        });
        assert.equal(tooSmall.status, 400);

        const removed = await agent.delete(`/api/sites/${created.body.id}`);
        assert.equal(removed.status, 204);

        const after = await agent.get(`/api/vehicles/${vehicle.body.id}`);
        assert.equal(after.body.home_site_id, null);
        assert.equal(after.body.depot, null);
    });

    it("hides another company's depot", async () => {
        const owner = await loginAs(1);
        const created = await owner.agent.post("/api/sites").send({
            name: "Köln",
            latitude: 50.9,
            longitude: 6.9,
        });
        const other = await loginAs(2);
        const missing = await other.agent
            .patch(`/api/sites/${created.body.id}`)
            .send({ name: "Fremd" });
        assert.equal(missing.status, 404);

        const listed = await other.agent.get("/api/sites");
        assert.deepEqual(listed.body.data, []);
    });

    it("ties a matching depot name to the home site", async () => {
        const { agent } = await loginAs(1);
        const created = await agent.post("/api/sites").send({
            name: "Köln",
            latitude: 50.9,
            longitude: 6.9,
        });
        const vehicle = await agent.post("/api/vehicles").send({
            license_plate: "K-HOME 2",
            fuel_level: 70,
            status: "IDLE",
            home_site_id: created.body.id,
        });
        assert.equal(vehicle.body.home_site_id, created.body.id);

        const freed = await agent
            .patch(`/api/vehicles/${vehicle.body.id}`)
            .send({ depot: "Freitext" });
        assert.equal(freed.status, 200);
        assert.equal(freed.body.home_site_id, null);
        assert.equal(freed.body.depot, "Freitext");

        const matched = await agent
            .patch(`/api/vehicles/${vehicle.body.id}`)
            .send({ depot: "Köln" });
        assert.equal(matched.body.home_site_id, created.body.id);
        assert.equal(matched.body.depot, "Köln");
    });
});
