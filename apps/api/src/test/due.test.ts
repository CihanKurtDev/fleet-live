import "./env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { DriverModel } from "../models/driver.model";
import { VehicleModel } from "../models/vehicle.model";
import { UserModel } from "../models/user.model";
import { loginAs } from "./helpers";

let api: ReturnType<typeof request.agent>;

beforeEach(async () => {
    api = (await loginAs(1)).agent;
});

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
});

describe("GET /api/due", () => {
    it("requires a session", async () => {
        const response = await request(app).get("/api/due");

        assert.equal(response.status, 401);
        assert.equal(response.body.code, "UNAUTHORIZED");
    });

    it("rejects an unknown state", async () => {
        const response = await api.get("/api/due?state=later");

        assert.equal(response.status, 400);
        assert.equal(response.body.code, "VALIDATION_ERROR");
    });

    it("lets a viewer read the same rows the briefing counted", async () => {
        VehicleModel.create({
            license_plate: "K-HU 1",
            company_id: 1,
            hu_due_on: "2020-01-01",
            uvv_due_on: null,
        });
        VehicleModel.create({
            license_plate: "K-XX 9",
            company_id: 2,
            hu_due_on: "2020-01-01",
        });
        DriverModel.create(1, "Nora Frist");
        DriverModel.create(2, "Fremd Fahrer");

        const viewer = (await loginAs(1, "viewer")).agent;
        const briefing = await viewer.get("/api/briefing");
        const overdue = await viewer.get("/api/due?state=overdue");
        const missing = await viewer.get("/api/due?state=missing");
        const labels = (overdue.body.data as Array<{ label: string }>).map(
            (row) => row.label,
        );

        assert.equal(briefing.status, 200);
        assert.equal(overdue.status, 200);
        assert.equal(
            overdue.body.meta.total,
            briefing.body.data.due.overdue,
        );
        assert.equal(overdue.body.meta.counts.overdue, 2);
        assert.ok(labels.includes("K-HU 1"));
        assert.ok(labels.includes("Nora Frist"));
        assert.equal(labels.includes("K-XX 9"), false);
        assert.equal(labels.includes("Fremd Fahrer"), false);
        assert.ok(
            (overdue.body.data as Array<{ kind: string; due_on: string | null }>).some(
                (row) => row.kind === "licence_check" && row.due_on === null,
            ),
        );
        const missingSum =
            briefing.body.data.due.missing.hu +
            briefing.body.data.due.missing.uvv +
            briefing.body.data.due.missing.licence_expiry;
        assert.equal(missing.body.meta.total, missingSum);
        assert.equal(missing.body.meta.counts.missing, missingSum);
    });

    it("returns the second page and a kind slice", async () => {
        for (let index = 0; index < 11; index += 1) {
            VehicleModel.create({
                license_plate: `K-P ${index}`,
                company_id: 1,
                hu_due_on: "2020-01-01",
                uvv_due_on: index === 0 ? "2020-02-01" : "2099-01-01",
            });
        }

        const page = await api.get("/api/due?state=overdue&page=2");
        const kind = await api.get("/api/due?state=overdue&kind=uvv");

        assert.equal(page.status, 200);
        assert.equal(page.body.meta.total, 12);
        assert.equal(page.body.meta.page, 2);
        assert.equal(page.body.data.length, 2);
        assert.equal(kind.body.meta.total, 1);
        assert.equal(kind.body.meta.counts.overdue, 12);
        assert.equal(kind.body.data[0].kind, "uvv");
    });

    it("finds a plate", async () => {
        VehicleModel.create({
            license_plate: "K-FIND 1",
            company_id: 1,
            hu_due_on: "2020-01-01",
        });
        VehicleModel.create({
            license_plate: "K-OTHER 1",
            company_id: 1,
            hu_due_on: "2020-01-01",
        });

        const response = await api.get("/api/due?state=overdue&search=find");

        assert.equal(response.status, 200);
        assert.equal(response.body.meta.total, 1);
        assert.equal(response.body.data[0].label, "K-FIND 1");
    });
});
