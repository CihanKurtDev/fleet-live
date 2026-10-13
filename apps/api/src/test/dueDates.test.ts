import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    DUE_RULES,
    INTERNAL_DUE_NOTICE,
    addIsoDays,
    addIsoMonths,
    berlinTodayIso,
    buildConfiguredDueRows,
    buildDueReminders,
    buildDueRows,
    classifyCalendarDate,
    classifyHuMonth,
    classifyLicenceCheck,
    dueCounts,
    dueLeadDaysSchema,
    licenceCheckMonthsSchema,
    parseDueListQuery,
    queryDueRows,
    resolveUvvDue,
    yearMonthSchema,
} from "@fleet-live/shared";

const TODAY = "2026-10-13";

describe("classifyCalendarDate", () => {
    it("treats an empty date as missing, not overdue", () => {
        assert.equal(classifyCalendarDate(null, TODAY), "missing");
        assert.equal(classifyCalendarDate("", TODAY), "missing");
    });

    it("marks yesterday overdue and a date inside 30 days as soon", () => {
        assert.equal(classifyCalendarDate("2026-10-12", TODAY), "overdue");
        assert.equal(classifyCalendarDate(TODAY, TODAY), "soon");
        assert.equal(
            classifyCalendarDate(addIsoDays(TODAY, 30), TODAY),
            "soon",
        );
        assert.equal(
            classifyCalendarDate(addIsoDays(TODAY, 31), TODAY),
            "ok",
        );
    });
});

describe("classifyLicenceCheck", () => {
    it("treats a missing check as overdue", () => {
        assert.deepEqual(classifyLicenceCheck(null, TODAY), {
            state: "overdue",
            due_on: null,
        });
    });

    it("is overdue once the check is older than six months", () => {
        const checked = addIsoDays(addIsoMonths(TODAY, -6), -1);
        const result = classifyLicenceCheck(checked, TODAY);

        assert.equal(result.state, "overdue");
        assert.equal(result.due_on, addIsoDays(TODAY, -1));
    });

    it("is soon when the next check falls inside 30 days", () => {
        const due = addIsoDays(TODAY, 10);
        const checked = addIsoMonths(due, -6);
        const result = classifyLicenceCheck(checked, TODAY);

        assert.equal(result.state, "soon");
        assert.equal(result.due_on, due);
    });

    it("clamps the day to the end of the month", () => {
        assert.equal(addIsoMonths("2026-01-31", 1), "2026-02-28");
        assert.equal(addIsoMonths("2024-01-31", 1), "2024-02-29");
    });
});

describe("buildDueReminders", () => {
    it("lists overdue before soon and counts empty calendar dates separately", () => {
        const summary = buildDueReminders({
            today: TODAY,
            vehicles: [
                {
                    id: 1,
                    license_plate: "K-HU 1",
                    hu_due_on: "2026-01-01",
                    uvv_due_on: null,
                },
                {
                    id: 2,
                    license_plate: "K-OK 1",
                    hu_due_on: "2027-06-01",
                    uvv_due_on: "2026-11-01",
                },
            ],
            drivers: [
                {
                    id: 7,
                    name: "Nora",
                    licence_expires_on: null,
                    licence_checked_on: null,
                },
                {
                    id: 8,
                    name: "Leo",
                    licence_expires_on: "2026-10-20",
                    licence_checked_on: "2026-08-01",
                },
            ],
        });

        assert.equal(summary.missing.hu, 0);
        assert.equal(summary.missing.uvv, 1);
        assert.equal(summary.missing.licence_expiry, 1);
        assert.deepEqual(
            summary.items.map((item) => `${item.state}:${item.kind}:${item.label}`),
            [
                "overdue:licence_check:Nora",
                "overdue:hu:K-HU 1",
                "soon:licence_expiry:Leo",
                "soon:uvv:K-OK 1",
            ],
        );
        assert.equal(summary.overdue, 2);
        assert.equal(summary.soon, 2);
        assert.equal(summary.items[0]?.due_on, null);
    });
});

describe("queryDueRows", () => {
    const rows = buildDueRows({
        today: TODAY,
        vehicles: [
            {
                id: 1,
                license_plate: "K-HU 1",
                hu_due_on: "2026-01-01",
                uvv_due_on: null,
            },
            {
                id: 2,
                license_plate: "K-OK 1",
                hu_due_on: "2027-06-01",
                uvv_due_on: "2026-11-01",
            },
        ],
        drivers: [
            {
                id: 7,
                name: "Nora",
                licence_expires_on: null,
                licence_checked_on: null,
            },
            {
                id: 8,
                name: "Leo",
                licence_expires_on: "2026-10-20",
                licence_checked_on: "2026-08-01",
            },
        ],
    });
    const counts = dueCounts(rows);

    it("counts the same rows the briefing tiles use", () => {
        const summary = buildDueReminders({
            today: TODAY,
            vehicles: [
                {
                    id: 1,
                    license_plate: "K-HU 1",
                    hu_due_on: "2026-01-01",
                    uvv_due_on: null,
                },
                {
                    id: 2,
                    license_plate: "K-OK 1",
                    hu_due_on: "2027-06-01",
                    uvv_due_on: "2026-11-01",
                },
            ],
            drivers: [
                {
                    id: 7,
                    name: "Nora",
                    licence_expires_on: null,
                    licence_checked_on: null,
                },
                {
                    id: 8,
                    name: "Leo",
                    licence_expires_on: "2026-10-20",
                    licence_checked_on: "2026-08-01",
                },
            ],
        });

        assert.equal(counts.overdue, summary.overdue);
        assert.equal(counts.soon, summary.soon);
        assert.deepEqual(counts.missing, summary.missing);
        assert.equal(
            rows.filter((row) => row.state === "missing").length,
            counts.missing.hu +
                counts.missing.uvv +
                counts.missing.licence_expiry,
        );
    });

    it("pages one state and keeps the tile count when the kind filter is off", () => {
        const page = queryDueRows(rows, parseDueListQuery({ state: "overdue" }));

        assert.equal(page.meta.total, counts.overdue);
        assert.equal(page.meta.counts.overdue, counts.overdue);
        assert.deepEqual(
            page.data.map((row) => `${row.kind}:${row.label}`),
            ["licence_check:Nora", "hu:K-HU 1"],
        );
    });

    it("filters by kind without changing the state counts", () => {
        const page = queryDueRows(
            rows,
            parseDueListQuery({ state: "soon", kind: "uvv" }),
        );

        assert.equal(page.meta.total, 1);
        assert.equal(page.data[0]?.label, "K-OK 1");
        assert.equal(page.meta.counts.soon, counts.soon);
        assert.equal(page.meta.kind_counts.uvv, 1);
        assert.equal(page.meta.kind_counts.all, counts.soon);
    });

    it("matches a plate or a driver name", () => {
        const page = queryDueRows(
            rows,
            parseDueListQuery({ state: "missing", search: "nora" }),
        );

        assert.equal(page.meta.total, 1);
        assert.equal(page.data[0]?.kind, "licence_expiry");
        assert.equal(page.meta.counts.missing, 1);
    });
});

describe("due rules", () => {
    it("keeps four rules and hides the legal basis until it is verified", () => {
        assert.deepEqual(
            DUE_RULES.map((rule) => rule.id),
            ["hu", "uvv", "licence_expiry", "licence_check"],
        );
        assert.equal(
            DUE_RULES.every((rule) => rule.verified === false && rule.basis.length > 0),
            true,
        );
    });

    it("uses the Berlin calendar date across midnight at month end", () => {
        assert.equal(
            berlinTodayIso(new Date("2026-10-31T22:59:00.000Z")),
            "2026-10-31",
        );
        assert.equal(
            berlinTodayIso(new Date("2026-10-31T23:00:00.000Z")),
            "2026-11-01",
        );
    });

    it("treats HU as due at month end, including a leap-year February", () => {
        assert.deepEqual(classifyHuMonth("2026-10", "2026-10-13", 30), {
            state: "soon",
            due_on: "2026-10-31",
        });
        assert.equal(classifyHuMonth("2026-10", "2026-10-31", 30).state, "soon");
        assert.equal(
            classifyHuMonth("2026-10", "2026-11-01", 30).state,
            "overdue",
        );
        assert.equal(classifyHuMonth("2024-02", "2024-02-29", 30).state, "soon");
        assert.equal(
            classifyHuMonth("2024-02", "2024-03-01", 30).state,
            "overdue",
        );
        assert.equal(classifyHuMonth(null, TODAY, 30).state, "missing");
    });

    it("ignores a manual UVV date that is not after the inspection", () => {
        assert.deepEqual(
            resolveUvvDue({
                checkedOn: "2026-10-15",
                manualDueOn: "2026-03-01",
                intervalMonths: 12,
            }),
            {
                due_on: "2027-10-15",
                source: "interval",
                last_on: "2026-10-15",
            },
        );
        assert.equal(
            resolveUvvDue({
                checkedOn: "2026-10-15",
                manualDueOn: "2027-12-01",
                intervalMonths: 12,
            }).due_on,
            "2027-12-01",
        );
        assert.equal(addIsoMonths("2026-01-31", 12), "2027-01-31");
        assert.equal(addIsoMonths("2024-08-31", 12), "2025-08-31");
        assert.equal(addIsoMonths("2025-08-31", 6), "2026-02-28");
        assert.equal(addIsoMonths("2024-02-29", 6), "2024-08-29");
    });

    it("rejects a month outside 01–12", () => {
        assert.equal(yearMonthSchema.safeParse("2026-12").success, true);
        assert.equal(yearMonthSchema.safeParse("2026-00").success, false);
        assert.equal(yearMonthSchema.safeParse("2026-13").success, false);
    });

    it("rejects a negative lead", () => {
        assert.equal(dueLeadDaysSchema.safeParse(0).success, true);
        assert.equal(dueLeadDaysSchema.safeParse(-1).success, false);
    });

    it("accepts a licence-check interval from 0 to 24", () => {
        assert.equal(licenceCheckMonthsSchema.safeParse(0).success, true);
        assert.equal(licenceCheckMonthsSchema.safeParse(24).success, true);
        assert.equal(licenceCheckMonthsSchema.safeParse(25).success, false);
    });

    it("drops inactive subjects and an interval that is switched off", () => {
        const rows = buildConfiguredDueRows({
            today: TODAY,
            leadDays: 30,
            licenceCheckMonths: 6,
            vehicles: [
                {
                    id: 1,
                    license_plate: "IN-AKTIV",
                    active: false,
                    hu_due_on: "2020-01",
                    uvv_checked_on: null,
                    uvv_due_on: "2020-01-01",
                },
                {
                    id: 2,
                    license_plate: "AKTIV",
                    hu_due_on: null,
                    uvv_checked_on: null,
                    uvv_due_on: null,
                },
            ],
            drivers: [
                {
                    id: 9,
                    name: "Inaktiv",
                    active: false,
                    licence_expires_on: null,
                    licence_checked_on: null,
                },
                {
                    id: 10,
                    name: "Aktiv",
                    licence_expires_on: null,
                    licence_checked_on: null,
                },
            ],
        });

        assert.equal(
            rows.some((row) => row.label === "IN-AKTIV" || row.label === "Inaktiv"),
            false,
        );
        assert.deepEqual(
            rows
                .filter((row) => row.label === "AKTIV")
                .map((row) => `${row.kind}:${row.state}`),
            ["hu:missing", "uvv:missing"],
        );
        const check = rows.find(
            (row) => row.kind === "licence_check" && row.label === "Aktiv",
        );
        assert.equal(check?.state, "overdue");
        assert.equal(check?.due_on, null);
        assert.equal(check?.explanation.basis, null);
        assert.equal(check?.explanation.internal_notice, INTERNAL_DUE_NOTICE);

        const off = buildConfiguredDueRows({
            today: TODAY,
            leadDays: 30,
            licenceCheckMonths: 0,
            vehicles: [],
            drivers: [
                {
                    id: 10,
                    name: "Aktiv",
                    licence_expires_on: null,
                    licence_checked_on: null,
                },
            ],
        });
        assert.equal(
            off.some((row) => row.kind === "licence_check"),
            false,
        );
    });
});
