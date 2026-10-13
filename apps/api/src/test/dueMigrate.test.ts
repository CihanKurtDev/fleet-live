import "./env";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { ZodError } from "zod";
import { ensureDueReminderColumns } from "../db/migrate";
import { CompanyModel } from "../models/company.model";

function legacyFleet(): DatabaseSync {
    const database = new DatabaseSync(":memory:");
    database.exec(`
        CREATE TABLE companies (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL
        );
        INSERT INTO companies (id, name) VALUES (1, 'Rheinland Logistik');

        CREATE TABLE drivers (
            id INTEGER PRIMARY KEY,
            company_id INTEGER NOT NULL,
            name TEXT NOT NULL
        );
        INSERT INTO drivers (id, company_id, name) VALUES
            (1, 1, 'Ada'),
            (2, 1, 'Bea');

        CREATE TABLE vehicles (
            id INTEGER PRIMARY KEY,
            company_id INTEGER NOT NULL,
            license_plate TEXT NOT NULL,
            hu_due_on TEXT,
            uvv_due_on TEXT
        );
        INSERT INTO vehicles (id, company_id, license_plate, hu_due_on, uvv_due_on) VALUES
            (1, 1, 'K-TAG 1', '2026-10-15', '2026-03-01'),
            (2, 1, 'K-KAPUTT 1', 'kein-datum', '2024-01-01'),
            (3, 1, 'K-LEER 1', NULL, NULL),
            (4, 1, 'K-SCHALT 1', '2026-02-31', NULL),
            (5, 1, 'K-ALT 1', '2026-10-15', NULL);
        ALTER TABLE vehicles ADD COLUMN hu_due_on_legacy TEXT;
        UPDATE vehicles
        SET hu_due_on_legacy = '1999-01-01'
        WHERE id = 5;
    `);

    return database;
}

function rowsOf<T extends object>(database: DatabaseSync, sql: string): T[] {
    return database
        .prepare(sql)
        .all()
        .map((row) => ({ ...(row as T) }));
}

function snapshot(database: DatabaseSync) {
    return {
        vehicles: rowsOf(database, `
            SELECT id, hu_due_on, hu_due_on_legacy, uvv_due_on, uvv_checked_on, active
            FROM vehicles
            ORDER BY id
        `),
        drivers: rowsOf(database, "SELECT id, active FROM drivers ORDER BY id"),
        companies: rowsOf(
            database,
            "SELECT id, due_lead_days, licence_check_months FROM companies",
        ),
    };
}

describe("due reminder migration", () => {
    it("shortens valid HU dates once and keeps the original in the backup", () => {
        const database = legacyFleet();

        ensureDueReminderColumns(database);
        const first = snapshot(database);

        assert.deepEqual(first.vehicles, [
            {
                id: 1,
                hu_due_on: "2026-10",
                hu_due_on_legacy: "2026-10-15",
                uvv_due_on: "2026-03-01",
                uvv_checked_on: null,
                active: 1,
            },
            {
                id: 2,
                hu_due_on: "kein-datum",
                hu_due_on_legacy: null,
                uvv_due_on: "2024-01-01",
                uvv_checked_on: null,
                active: 1,
            },
            {
                id: 3,
                hu_due_on: null,
                hu_due_on_legacy: null,
                uvv_due_on: null,
                uvv_checked_on: null,
                active: 1,
            },
            {
                id: 4,
                hu_due_on: "2026-02-31",
                hu_due_on_legacy: null,
                uvv_due_on: null,
                uvv_checked_on: null,
                active: 1,
            },
            {
                id: 5,
                hu_due_on: "2026-10",
                hu_due_on_legacy: "1999-01-01",
                uvv_due_on: null,
                uvv_checked_on: null,
                active: 1,
            },
        ]);
        assert.deepEqual(first.drivers, [
            { id: 1, active: 1 },
            { id: 2, active: 1 },
        ]);
        assert.deepEqual(first.companies, [
            { id: 1, due_lead_days: null, licence_check_months: null },
        ]);

        ensureDueReminderColumns(database);
        assert.deepEqual(snapshot(database), first);
        database.close();
    });
});

describe("company due settings", () => {
    it("reads null as the catalog default and rejects a lead or interval outside the catalog", () => {
        const settings = CompanyModel.dueSettings(1);

        assert.deepEqual(
            settings === undefined ? undefined : { ...settings },
            {
                due_lead_days: null,
                licence_check_months: null,
            },
        );

        assert.deepEqual(
            CompanyModel.updateDueSettings(1, {
                due_lead_days: 0,
                licence_check_months: 24,
            }),
            { due_lead_days: 0, licence_check_months: 24 },
        );
        assert.throws(
            () => CompanyModel.updateDueSettings(1, { due_lead_days: -1 }),
            ZodError,
        );
        assert.throws(
            () =>
                CompanyModel.updateDueSettings(1, { licence_check_months: 25 }),
            ZodError,
        );
        assert.deepEqual(
            { ...CompanyModel.dueSettings(1) },
            {
                due_lead_days: 0,
                licence_check_months: 24,
            },
        );

        CompanyModel.updateDueSettings(1, {
            due_lead_days: null,
            licence_check_months: 0,
        });
        assert.deepEqual(
            { ...CompanyModel.dueSettings(1) },
            {
                due_lead_days: null,
                licence_check_months: 0,
            },
        );
    });
});
