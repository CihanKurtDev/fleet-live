import { importActionKey } from "./import";
import type {
    ImportPreviewRow,
    ImportRowAction,
    ImportRowIssue,
} from "./import";

const DEFERRED_CODES = new Set(["DRIVER_ON_TRIP"]);

const ALREADY_THERE_CODES = new Set([
    "EXISTING_PLATE",
    "EXISTING_DRIVER",
    "EXISTING_ELIGIBILITY",
    "ALREADY_CURRENT",
    "EXISTING_VIN",
]);

export function isAlreadyThereRow(row: ImportPreviewRow): boolean {
    return row.issues.some((issue) => ALREADY_THERE_CODES.has(issue.code));
}

export type ImportRowOutcome =
    | { status: "blocked"; issue: ImportRowIssue }
    | { status: "deferred"; issue: ImportRowIssue }
    | { status: "skipped"; issue: ImportRowIssue | null }
    | { status: "ready" };

export type ImportOutcomeDisableReason =
    | "all_skipped"
    | "only_errors"
    | "mixed_no_ready";

/** Max. Beispielzeilen in Attention-Panels (Counts bleiben exakt). */
export const IMPORT_OUTCOME_EXAMPLE_LIMIT = 4;

export type ImportOutcomeSummary = {
    readyCount: number;
    blockedCount: number;
    deferredCount: number;
    skippedCount: number;
    /** skip wegen schon im Bestand (nicht wegen Fehler/Fahrt). */
    alreadyThereCount: number;
    blockedRows: Array<{
        row: ImportPreviewRow;
        outcome: ImportRowOutcome & { status: "blocked" };
    }>;
    deferredRows: Array<{
        row: ImportPreviewRow;
        outcome: ImportRowOutcome & { status: "deferred" };
    }>;
    canCommit: boolean;
    disableReason: ImportOutcomeDisableReason | null;
};

function primaryError(issues: ImportRowIssue[]): ImportRowIssue | undefined {
    return issues.find((issue) => issue.level === "error");
}

function primaryDeferred(issues: ImportRowIssue[]): ImportRowIssue | undefined {
    return issues.find((issue) => DEFERRED_CODES.has(issue.code));
}

function primarySkipNote(issues: ImportRowIssue[]): ImportRowIssue | null {
    return (
        issues.find((issue) => issue.level === "warning") ?? null
    );
}

/**
 * Einzige Stelle, die den Outcome einer Import-Zeile bestimmt.
 * Priorität: blocked > deferred > skipped > ready.
 * Immer die effektive (UI-)Aktion übergeben, nicht blind default_action.
 */
export function getImportRowOutcome(
    row: ImportPreviewRow,
    effectiveAction: ImportRowAction,
): ImportRowOutcome {
    const error = primaryError(row.issues);
    if (error) {
        return { status: "blocked", issue: error };
    }

    if (effectiveAction === "skip") {
        const deferred = primaryDeferred(row.issues);
        if (deferred) {
            return { status: "deferred", issue: deferred };
        }

        return { status: "skipped", issue: primarySkipNote(row.issues) };
    }

    return { status: "ready" };
}

export function summarizeImportOutcomes(
    rows: ImportPreviewRow[],
    actions: Record<string, ImportRowAction>,
): ImportOutcomeSummary {
    let readyCount = 0;
    let blockedCount = 0;
    let deferredCount = 0;
    let skippedCount = 0;
    let alreadyThereCount = 0;
    const blockedRows: ImportOutcomeSummary["blockedRows"] = [];
    const deferredRows: ImportOutcomeSummary["deferredRows"] = [];

    for (const row of rows) {
        const key = importActionKey(row.sheet_kind, row.row_index);
        const action = actions[key] ?? row.default_action;
        const outcome = getImportRowOutcome(row, action);

        switch (outcome.status) {
            case "ready":
                readyCount += 1;
                break;
            case "blocked":
                blockedCount += 1;
                if (blockedRows.length < IMPORT_OUTCOME_EXAMPLE_LIMIT) {
                    blockedRows.push({ row, outcome });
                }
                break;
            case "deferred":
                deferredCount += 1;
                if (deferredRows.length < IMPORT_OUTCOME_EXAMPLE_LIMIT) {
                    deferredRows.push({ row, outcome });
                }
                break;
            case "skipped":
                skippedCount += 1;
                if (isAlreadyThereRow(row)) {
                    alreadyThereCount += 1;
                }
                break;
        }
    }

    const canCommit = readyCount > 0;
    let disableReason: ImportOutcomeDisableReason | null = null;

    if (!canCommit) {
        if (
            blockedCount > 0 &&
            readyCount === 0 &&
            deferredCount + skippedCount === 0
        ) {
            disableReason = "only_errors";
        } else if (blockedCount > 0) {
            disableReason = "mixed_no_ready";
        } else {
            disableReason = "all_skipped";
        }
    }

    return {
        readyCount,
        blockedCount,
        deferredCount,
        skippedCount,
        alreadyThereCount,
        blockedRows,
        deferredRows,
        canCommit,
        disableReason,
    };
}

export function importCommitDisableMessage(
    summary: ImportOutcomeSummary,
): string | null {
    if (summary.canCommit || !summary.disableReason) {
        return null;
    }

    if (summary.disableReason === "all_skipped") {
        if (summary.alreadyThereCount > 0) {
            return "Alles schon im Bestand. Nichts Neues zu übernehmen.";
        }

        return "Keine Zeile ist zum Import markiert.";
    }

    if (summary.disableReason === "only_errors") {
        return summary.blockedCount === 1
            ? "1 Zeile enthält Fehler."
            : `${summary.blockedCount} Zeilen enthalten Fehler.`;
    }

    return summary.blockedCount === 1
        ? "1 Zeile enthält Fehler; der Rest wird übersprungen."
        : `${summary.blockedCount} Zeilen enthalten Fehler; der Rest wird übersprungen.`;
}

export function importCommitButtonLabel(readyCount: number): string {
    if (readyCount <= 0) {
        return "Import ausführen";
    }

    if (readyCount === 1) {
        return "1 Änderung importieren";
    }

    return `${readyCount} Änderungen importieren`;
}

export function rowSubject(row: ImportPreviewRow): string {
    if (row.driver_name && row.license_plate) {
        return `${row.driver_name} · ${row.license_plate}`;
    }

    return row.license_plate ?? row.driver_name ?? `Zeile ${row.row_index}`;
}
