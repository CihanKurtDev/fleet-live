import "./env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import request from "supertest";
import { app } from "../app";
import { VehicleModel } from "../models/vehicle.model";
import { UserModel } from "../models/user.model";
import { resetImportPreviewStoreForTests } from "../lib/importPreviewStore";
import { loginAs } from "./helpers";

const SAMPLE_CSV = `Kennzeichen;Tank;Status;Fahrer
B-IMP 101;80;Standby;Anna Schmidt
B-IMP 102;;Unterwegs;Ben Müller
`;

afterEach(() => {
    VehicleModel.resetForTests();
    UserModel.resetForTests();
    resetImportPreviewStoreForTests();
});

describe("POST /api/import/preview", () => {
    it("returns column suggestions and preview rows", async () => {
        const { agent } = await loginAs(1);

        const response = await agent
            .post("/api/import/preview")
            .send({ csv: SAMPLE_CSV })
            .expect(200);

        assert.equal(response.body.data.columns.length, 4);
        assert.equal(
            response.body.data.suggested_mapping.Kennzeichen,
            "license_plate",
        );
        assert.equal(response.body.data.rows.length, 2);
        assert.equal(response.body.data.rows[0].license_plate, "B-IMP 101");
        assert.equal(response.body.data.rows[0].status, "IDLE");
        assert.equal(response.body.data.rows[1].status, "DRIVING");
        assert.equal(response.body.data.rows[0].default_action, "create");
        assert.ok(response.body.data.preview_id);
        assert.equal(response.body.data.can_commit, true);
    });

    it("flags duplicate plates in the same file as errors", async () => {
        const { agent } = await loginAs(1);
        const csv = `Kennzeichen;Tank
B-DUP 1;50
B-DUP 1;60
`;

        const response = await agent
            .post("/api/import/preview")
            .send({ csv })
            .expect(200);

        assert.equal(response.body.data.counts.errors, 2);
        assert.equal(response.body.data.can_commit, false);
    });

    it("defaults existing plates to skip with a warning", async () => {
        VehicleModel.create({
            license_plate: "B-OLD 1",
            company_id: 1,
        });

        const { agent } = await loginAs(1);
        const response = await agent
            .post("/api/import/preview")
            .send({ csv: "Kennzeichen;Tank\nB-OLD 1;40\n" })
            .expect(200);

        assert.equal(response.body.data.rows[0].default_action, "skip");
        assert.ok(
            response.body.data.rows[0].issues.some(
                (issue: { code: string }) => issue.code === "EXISTING_PLATE",
            ),
        );
    });

    it("returns 403 for viewers", async () => {
        const { agent } = await loginAs(1, "viewer");

        await agent
            .post("/api/import/preview")
            .send({ csv: SAMPLE_CSV })
            .expect(403);
    });
});

describe("POST /api/import/commit", () => {
    it("creates vehicles from a preview", async () => {
        const { agent } = await loginAs(1);

        const preview = await agent
            .post("/api/import/preview")
            .send({ csv: SAMPLE_CSV })
            .expect(200);

        const commit = await agent
            .post("/api/import/commit")
            .send({ preview_id: preview.body.data.preview_id })
            .expect(200);

        assert.equal(commit.body.data.created_vehicles, 2);
        assert.equal(commit.body.data.created_drivers, 2);

        const list = await agent.get("/api/vehicles?search=B-IMP").expect(200);
        assert.equal(list.body.data.length, 2);
    });

    it("updates an existing vehicle when row action is update", async () => {
        VehicleModel.create({
            license_plate: "B-UPD 1",
            fuel_level: 50,
            company_id: 1,
        });

        const { agent } = await loginAs(1);
        const preview = await agent
            .post("/api/import/preview")
            .send({ csv: "Kennzeichen;Tank\nB-UPD 1;20\n" })
            .expect(200);

        const rowIndex = preview.body.data.rows[0].row_index;

        const commit = await agent
            .post("/api/import/commit")
            .send({
                preview_id: preview.body.data.preview_id,
                row_actions: { [String(rowIndex)]: "update" },
            })
            .expect(200);

        assert.equal(commit.body.data.updated_vehicles, 1);
        assert.equal(commit.body.data.skipped_rows, 0);

        const vehicle = await agent.get("/api/vehicles?search=B-UPD").expect(200);
        assert.equal(vehicle.body.data[0].fuel_level, 20);
    });

    it("returns 404 for an unknown preview id", async () => {
        const { agent } = await loginAs(1);

        await agent
            .post("/api/import/commit")
            .send({ preview_id: "00000000-0000-0000-0000-000000000000" })
            .expect(404);
    });
});
