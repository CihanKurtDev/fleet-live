import "./env";
import assert from "node:assert/strict";
import { dueExplanationText } from "@fleet-live/shared";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { db } from "../db/database";
import { CompanyModel } from "../models/company.model";
import { DriverModel } from "../models/driver.model";
import { DueModel } from "../models/due.model";
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
        const stored = VehicleModel.create({
            license_plate: "K-HU 1",
            company_id: 1,
            hu_due_on: "2020-01-01",
            uvv_due_on: "2099-01-01",
        });
        assert.equal(stored.hu_due_on, "2020-01");
        assert.equal(stored.uvv_due_on, "2099-01-01");
        assert.equal(stored.uvv_checked_on, null);
        assert.equal(stored.active, true);
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

    it("says whether the company has vehicles and drivers at all", async () => {
        const empty = await api.get("/api/due?state=overdue");

        assert.equal(empty.status, 200);
        assert.deepEqual(empty.body.meta.subjects, { vehicles: 0, drivers: 0 });

        VehicleModel.create({
            license_plate: "K-DA 1",
            company_id: 1,
            hu_due_on: "2099-01-01",
            uvv_due_on: "2099-01-01",
        });
        DriverModel.create(2, "Fremd Fahrer");

        const searched = await api.get("/api/due?state=overdue&search=nichts");

        assert.equal(searched.body.meta.total, 0);
        assert.deepEqual(searched.body.meta.subjects, {
            vehicles: 1,
            drivers: 0,
        });
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

    it("skips inactive vehicles and drivers in the list and the briefing", async () => {
        const parked = VehicleModel.create({
            license_plate: "K-AUS 1",
            company_id: 1,
            hu_due_on: "2020-01-01",
        });
        db.prepare("UPDATE vehicles SET active = 0 WHERE id = ?").run(parked.id);
        VehicleModel.create({
            license_plate: "K-AN 1",
            company_id: 1,
            hu_due_on: "2020-01-01",
        });
        const away = DriverModel.create(1, "Inaktiv Fahrer");
        db.prepare("UPDATE drivers SET active = 0 WHERE id = ?").run(away.id);
        DriverModel.create(1, "Aktiv Fahrer");

        const overdue = await api.get("/api/due?state=overdue");
        const briefing = await api.get("/api/briefing");
        const labels = (overdue.body.data as Array<{ label: string }>).map(
            (row) => row.label,
        );

        assert.equal(overdue.status, 200);
        assert.equal(labels.includes("K-AN 1"), true);
        assert.equal(labels.includes("Aktiv Fahrer"), true);
        assert.equal(labels.includes("K-AUS 1"), false);
        assert.equal(labels.includes("Inaktiv Fahrer"), false);
        assert.equal(
            overdue.body.meta.total,
            briefing.body.data.due.overdue,
        );
    });

    it("counts the HU month end and a later inspection instead of the old day", () => {
        const month = VehicleModel.create({
            license_plate: "K-MON 1",
            company_id: 1,
            hu_due_on: "2026-10-15",
        });
        const inspected = VehicleModel.create({
            license_plate: "K-UVV 1",
            company_id: 1,
            uvv_due_on: "2026-03-01",
        });
        db.prepare("UPDATE vehicles SET uvv_checked_on = ? WHERE id = ?").run(
            "2026-10-15",
            inspected.id,
        );

        const rows = DueModel.rowsForCompany(1, "2026-10-13");
        const hu = rows.find(
            (row) => row.vehicle_id === month.id && row.kind === "hu",
        );
        const uvv = rows.find(
            (row) => row.vehicle_id === inspected.id && row.kind === "uvv",
        );

        assert.equal(hu?.state, "soon");
        assert.equal(hu?.due_on, "2026-10-31");
        assert.equal(
            hu?.explanation
                ? dueExplanationText("hu", hu.explanation)
                : "",
            "HU, fällig am 31.10.2026.",
        );
        assert.equal(uvv, undefined);
    });

    it("uses a company lead and can switch the licence check off", () => {
        CompanyModel.updateDueSettings(1, {
            due_lead_days: 0,
            licence_check_months: 0,
        });

        try {
            const month = VehicleModel.create({
                license_plate: "K-LEAD 1",
                company_id: 1,
                hu_due_on: "2026-10-15",
            });
            DriverModel.create(1, "Ohne Kontrolle");

            const narrowed = DueModel.rowsForCompany(1, "2026-10-13");
            const hu = narrowed.find(
                (row) => row.vehicle_id === month.id && row.kind === "hu",
            );

            assert.equal(hu, undefined);
            assert.equal(
                narrowed.some((row) => row.kind === "licence_check"),
                false,
            );
        } finally {
            CompanyModel.updateDueSettings(1, {
                due_lead_days: null,
                licence_check_months: null,
            });
        }

        const restored = VehicleModel.create({
            license_plate: "K-LEAD 2",
            company_id: 1,
            hu_due_on: "2026-10-15",
        });
        DriverModel.create(1, "Mit Kontrolle");
        const rows = DueModel.rowsForCompany(1, "2026-10-13");

        assert.equal(
            rows.find((row) => row.vehicle_id === restored.id && row.kind === "hu")
                ?.state,
            "soon",
        );
        assert.equal(
            rows.some(
                (row) => row.label === "Mit Kontrolle" && row.kind === "licence_check",
            ),
            true,
        );
    });
});

describe("GET and PATCH /api/due/settings", () => {
    it("requires a session", async () => {
        const response = await request(app).get("/api/due/settings");

        assert.equal(response.status, 401);
        assert.equal(response.body.code, "UNAUTHORIZED");
    });

    it("lets a viewer read the catalog and blocks a write", async () => {
        const viewer = (await loginAs(1, "viewer")).agent;
        const read = await viewer.get("/api/due/settings");

        assert.equal(read.status, 200);
        assert.deepEqual(read.body.data, {
            due_lead_days: null,
            licence_check_months: null,
            lead_days: 30,
            check_months: 6,
        });

        const denied = await viewer.patch("/api/due/settings").send({
            due_lead_days: 14,
        });

        assert.equal(denied.status, 403);
        assert.equal(denied.body.code, "FORBIDDEN");
    });

    it("stores a shorter lead and can switch the licence check off", async () => {
        try {
            const saved = await api.patch("/api/due/settings").send({
                due_lead_days: 14,
                licence_check_months: 0,
            });

            assert.equal(saved.status, 200);
            assert.equal(saved.body.data.due_lead_days, 14);
            assert.equal(saved.body.data.licence_check_months, 0);
            assert.equal(saved.body.data.lead_days, 14);
            assert.equal(saved.body.data.check_months, 0);

            const month = VehicleModel.create({
                license_plate: "K-SET 1",
                company_id: 1,
                hu_due_on: "2026-10-15",
            });
            DriverModel.create(1, "Kontrolle aus");
            const rows = DueModel.rowsForCompany(1, "2026-10-13");

            assert.equal(
                rows.find((row) => row.vehicle_id === month.id && row.kind === "hu"),
                undefined,
            );
            assert.equal(
                rows.some((row) => row.kind === "licence_check"),
                false,
            );

            const list = await api.get("/api/due?state=soon");
            assert.equal(list.body.meta.lead_days, 14);
            assert.equal(list.body.meta.licence_check_months, 0);

            const briefing = await api.get("/api/briefing");
            assert.equal(briefing.body.data.due_lead_days, 14);

            const invalid = await api.patch("/api/due/settings").send({
                due_lead_days: -1,
            });

            assert.equal(invalid.status, 400);
            assert.equal(invalid.body.code, "VALIDATION_ERROR");
            assert.match(invalid.body.fields.due_lead_days, /nicht negativ/);

            const tooLong = await api.patch("/api/due/settings").send({
                due_lead_days: 366,
            });

            assert.equal(tooLong.status, 400);
            assert.equal(tooLong.body.code, "VALIDATION_ERROR");
            assert.match(tooLong.body.fields.due_lead_days, /höchstens 365/);
        } finally {
            CompanyModel.updateDueSettings(1, {
                due_lead_days: null,
                licence_check_months: null,
            });
        }
    });
});
