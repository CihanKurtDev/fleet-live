import "./env";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    getImportRowOutcome,
    importActionKey,
    importCommitButtonLabel,
    importCommitDisableMessage,
    summarizeImportOutcomes,
    type ImportPreviewRow,
    type ImportRowAction,
    type ImportRowIssue,
} from "@fleet-live/shared";

function row(
    partial: Partial<ImportPreviewRow> &
        Pick<ImportPreviewRow, "sheet_kind" | "row_index" | "default_action">,
): ImportPreviewRow {
    return {
        license_plate: null,
        fuel_level: null,
        status: null,
        driver_name: null,
        vin: null,
        vehicle_type: null,
        hu_due_on: null,
        depot: null,
        cost_center: null,
        phone: null,
        issues: [],
        ...partial,
    };
}

function issue(
    level: ImportRowIssue["level"],
    code: string,
    message = code,
): ImportRowIssue {
    return { level, code, message };
}

describe("getImportRowOutcome", () => {
    it("is ready for create/update without issues", () => {
        const preview = row({
            sheet_kind: "vehicles",
            row_index: 1,
            default_action: "create",
            license_plate: "B-NEW 1",
        });

        assert.equal(getImportRowOutcome(preview, "create").status, "ready");
        assert.equal(getImportRowOutcome(preview, "update").status, "ready");
    });

    it("is skipped for EXISTING_PLATE with skip", () => {
        const preview = row({
            sheet_kind: "vehicles",
            row_index: 1,
            default_action: "skip",
            license_plate: "B-OLD 1",
            issues: [
                issue(
                    "warning",
                    "EXISTING_PLATE",
                    "Kennzeichen ist schon im Bestand.",
                ),
            ],
        });

        const outcome = getImportRowOutcome(preview, "skip");
        assert.equal(outcome.status, "skipped");
        if (outcome.status === "skipped") {
            assert.equal(outcome.issue?.code, "EXISTING_PLATE");
        }
    });

    it("is deferred for DRIVER_ON_TRIP with skip", () => {
        const preview = row({
            sheet_kind: "current",
            row_index: 1,
            default_action: "skip",
            driver_name: "Nora Weber",
            license_plate: "K-XLS 1001",
            issues: [
                issue(
                    "warning",
                    "DRIVER_ON_TRIP",
                    "Nora Weber ist noch unterwegs auf K-IMP 1001. Aktuelles Fahrzeug wird übersprungen (erst nach der Fahrt wechseln).",
                ),
            ],
        });

        const outcome = getImportRowOutcome(preview, "skip");
        assert.equal(outcome.status, "deferred");
        if (outcome.status === "deferred") {
            assert.equal(outcome.issue.code, "DRIVER_ON_TRIP");
        }
    });

    it("is blocked for a real error", () => {
        const preview = row({
            sheet_kind: "vehicles",
            row_index: 2,
            default_action: "skip",
            issues: [issue("error", "MISSING_PLATE", "Kennzeichen fehlt.")],
        });

        const outcome = getImportRowOutcome(preview, "skip");
        assert.equal(outcome.status, "blocked");
        if (outcome.status === "blocked") {
            assert.equal(outcome.issue.code, "MISSING_PLATE");
        }
    });

    it("prefers blocked over deferred when both are present", () => {
        const preview = row({
            sheet_kind: "current",
            row_index: 1,
            default_action: "skip",
            driver_name: "Nora Weber",
            license_plate: null,
            issues: [
                issue(
                    "warning",
                    "DRIVER_ON_TRIP",
                    "Nora Weber ist noch unterwegs auf K-IMP 1001.",
                ),
                issue("error", "MISSING_PLATE", "Kennzeichen fehlt."),
            ],
        });

        const outcome = getImportRowOutcome(preview, "skip");
        assert.equal(outcome.status, "blocked");
        if (outcome.status === "blocked") {
            assert.equal(outcome.issue.code, "MISSING_PLATE");
        }
    });

    it("uses effectiveAction, not default_action", () => {
        const preview = row({
            sheet_kind: "vehicles",
            row_index: 1,
            default_action: "skip",
            license_plate: "B-OLD 1",
            issues: [issue("warning", "EXISTING_PLATE")],
        });

        assert.equal(getImportRowOutcome(preview, "skip").status, "skipped");
        assert.equal(getImportRowOutcome(preview, "update").status, "ready");
    });

    it("treats forced create on DRIVER_ON_TRIP as ready (commit soft-fails)", () => {
        const preview = row({
            sheet_kind: "current",
            row_index: 1,
            default_action: "skip",
            issues: [issue("warning", "DRIVER_ON_TRIP")],
        });

        assert.equal(getImportRowOutcome(preview, "create").status, "ready");
    });
});

describe("summarizeImportOutcomes", () => {
    it("enables commit when at least one row is ready", () => {
        const rows = [
            row({
                sheet_kind: "vehicles",
                row_index: 1,
                default_action: "create",
                license_plate: "B-NEW 1",
            }),
            row({
                sheet_kind: "current",
                row_index: 1,
                default_action: "skip",
                driver_name: "Nora Weber",
                license_plate: "K-XLS 1001",
                issues: [issue("warning", "DRIVER_ON_TRIP")],
            }),
        ];

        const summary = summarizeImportOutcomes(rows, {});
        assert.equal(summary.readyCount, 1);
        assert.equal(summary.deferredCount, 1);
        assert.equal(summary.blockedCount, 0);
        assert.equal(summary.canCommit, true);
        assert.equal(summary.disableReason, null);
        assert.equal(summary.blockedRows.length, 0);
        assert.equal(importCommitDisableMessage(summary), null);
        assert.equal(importCommitButtonLabel(summary.readyCount), "1 Änderung importieren");
    });

    it("disables with all_skipped when only skip and deferred", () => {
        const rows = [
            row({
                sheet_kind: "vehicles",
                row_index: 1,
                default_action: "skip",
                issues: [issue("warning", "EXISTING_PLATE")],
            }),
            row({
                sheet_kind: "current",
                row_index: 1,
                default_action: "skip",
                issues: [issue("warning", "DRIVER_ON_TRIP")],
            }),
        ];

        const summary = summarizeImportOutcomes(rows, {});
        assert.equal(summary.canCommit, false);
        assert.equal(summary.disableReason, "all_skipped");
        assert.equal(summary.alreadyThereCount, 1);
        assert.equal(summary.blockedRows.length, 0);
        assert.equal(summary.deferredRows.length, 1);
        assert.match(
            importCommitDisableMessage(summary) ?? "",
            /schon im Bestand/,
        );
    });

    it("disables with only_errors when every row is blocked", () => {
        const rows = [
            row({
                sheet_kind: "vehicles",
                row_index: 1,
                default_action: "skip",
                issues: [issue("error", "MISSING_PLATE")],
            }),
            row({
                sheet_kind: "vehicles",
                row_index: 2,
                default_action: "skip",
                issues: [issue("error", "INVALID_VIN")],
            }),
        ];

        const summary = summarizeImportOutcomes(rows, {});
        assert.equal(summary.canCommit, false);
        assert.equal(summary.disableReason, "only_errors");
        assert.equal(summary.blockedCount, 2);
        assert.equal(summary.blockedRows.length, 2);
        assert.equal(
            importCommitDisableMessage(summary),
            "2 Zeilen enthalten Fehler.",
        );
    });

    it("lists blocked and deferred rows for the attention lists", () => {
        const rows = [
            row({
                sheet_kind: "vehicles",
                row_index: 1,
                default_action: "create",
            }),
            row({
                sheet_kind: "vehicles",
                row_index: 2,
                default_action: "skip",
                issues: [issue("error", "MISSING_PLATE", "Kennzeichen fehlt.")],
            }),
            row({
                sheet_kind: "current",
                row_index: 1,
                default_action: "skip",
                issues: [issue("warning", "DRIVER_ON_TRIP")],
            }),
        ];

        const summary = summarizeImportOutcomes(rows, {});
        assert.equal(summary.canCommit, true);
        assert.equal(summary.blockedRows.length, 1);
        assert.equal(summary.blockedRows[0]?.row.row_index, 2);
        assert.equal(summary.deferredCount, 1);
        assert.equal(summary.deferredRows.length, 1);
        assert.equal(summary.deferredRows[0]?.row.row_index, 1);
    });

    it("respects effective action overrides in the action map", () => {
        const preview = row({
            sheet_kind: "vehicles",
            row_index: 1,
            default_action: "skip",
            issues: [issue("warning", "EXISTING_PLATE")],
        });
        const key = importActionKey("vehicles", 1);
        const actions: Record<string, ImportRowAction> = {
            [key]: "update",
        };

        const summary = summarizeImportOutcomes([preview], actions);
        assert.equal(summary.readyCount, 1);
        assert.equal(summary.canCommit, true);
        assert.equal(
            importCommitButtonLabel(summary.readyCount),
            "1 Änderung importieren",
        );
    });
});
