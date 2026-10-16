import {
    INTERNAL_DUE_NOTICE,
    dueRule,
    type DueKind,
    type DueListItem,
    type DueRuleKind,
} from "@fleet-live/shared";
import { formatIsoDate, formatYearMonth } from "../../utils/dateTime";

/** How strongly a row asks for action. Drives the colour of its pill. */
export type DueTone = "block" | "legal" | "internal" | "soon" | "missing";

export type DueGroupDef = {
    kind: DueKind;
    title: string;
};

/** Order on the page: what stops a vehicle or driver first. */
export const DUE_GROUPS: readonly DueGroupDef[] = [
    { kind: "licence_expiry", title: "Führerschein" },
    { kind: "hu", title: "HU" },
    { kind: "uvv", title: "UVV" },
    { kind: "licence_check", title: "Führerscheinkontrolle" },
];

const RULE_KIND_LABELS: Record<DueRuleKind, string> = {
    statutory: "gesetzliche Frist",
    recommended: "Empfehlung",
    internal: "interne Vorgabe",
};

/** Legal source only once the catalog marks it as checked. */
export function dueBasis(kind: DueKind): string | null {
    const rule = dueRule(kind);
    return rule.verified ? rule.basis : null;
}

/** Short label under a group title: the checked source, else the rule type. */
export function dueGroupNote(kind: DueKind): string {
    return dueBasis(kind) ?? RULE_KIND_LABELS[dueRule(kind).rule_kind];
}

/** How the date of this kind is calculated, in the company's settings. */
export function dueRuleText(kind: DueKind, checkMonths: number): string {
    if (kind === "hu") {
        return "Fällig zum Ende des eingetragenen Monats.";
    }

    if (kind === "uvv") {
        const months = dueRule("uvv").interval_months ?? 12;
        return `Letzte Prüfung plus ${months} Monate, oder das manuell eingetragene Datum.`;
    }

    if (kind === "licence_expiry") {
        return "Eingetragenes Ablaufdatum. Ab dem Tag danach überfällig.";
    }

    if (checkMonths === 0) {
        return "Ausgeschaltet.";
    }

    return `Letzte Kontrolle plus ${checkMonths} Monate. Ohne Kontrolldatum überfällig. ${INTERNAL_DUE_NOTICE}.`;
}

function daysBetween(fromIso: string, toIso: string): number {
    const from = Date.parse(`${fromIso}T00:00:00Z`);
    const to = Date.parse(`${toIso}T00:00:00Z`);
    return Math.round((to - from) / 86_400_000);
}

function dayCount(days: number): string {
    return days === 1 ? "1 Tag" : `${days} Tagen`;
}

export function dueDateText(row: DueListItem): string {
    if (row.due_on === null) {
        return row.kind === "licence_check" ? "nie" : "—";
    }

    if (row.kind === "hu") {
        return formatYearMonth(row.due_on.slice(0, 7));
    }

    return formatIsoDate(row.due_on);
}

/** Where the date comes from, one short line. */
export function dueRowRule(row: DueListItem, checkMonths: number): string {
    const lastOn = row.explanation?.last_on ?? null;

    if (row.kind === "hu") {
        return row.due_on ? "fällig zum Monatsende" : "kein HU-Monat eingetragen";
    }

    if (row.kind === "uvv") {
        if (row.due_on === null) {
            return "keine Prüfung eingetragen";
        }

        if (row.explanation?.source === "manual") {
            return "manuell eingetragenes Datum";
        }

        const months = row.explanation?.interval_months ?? 12;
        return lastOn
            ? `letzte Prüfung ${formatIsoDate(lastOn)} + ${months} Monate`
            : `alle ${months} Monate`;
    }

    if (row.kind === "licence_expiry") {
        return row.due_on ? "eingetragenes Ablaufdatum" : "kein Ablaufdatum eingetragen";
    }

    return lastOn
        ? `letzte Kontrolle ${formatIsoDate(lastOn)} + ${checkMonths} Monate`
        : `kein Kontrolldatum · alle ${checkMonths} Monate`;
}

/** What the row means today: label plus tone for its pill. */
export function dueConsequence(
    row: DueListItem,
    today: string,
): { label: string; tone: DueTone } {
    if (row.state === "missing") {
        return { label: "Datum fehlt", tone: "missing" };
    }

    if (row.state === "soon") {
        const days = row.due_on ? daysBetween(today, row.due_on) : 0;
        return {
            label: days <= 0 ? "heute fällig" : `in ${dayCount(days)}`,
            tone: "soon",
        };
    }

    if (row.due_on === null) {
        return { label: "noch nie kontrolliert", tone: "internal" };
    }

    const late = Math.max(1, daysBetween(row.due_on, today));

    if (row.kind === "licence_expiry") {
        return { label: `abgelaufen seit ${dayCount(late)}`, tone: "block" };
    }

    if (row.kind === "licence_check") {
        return { label: `seit ${dayCount(late)} überfällig`, tone: "internal" };
    }

    return { label: `seit ${dayCount(late)} überfällig`, tone: "legal" };
}

/** Message for a group without rows. */
export function dueGroupEmpty(
    kind: DueKind,
    state: DueListItem["state"],
    hasSearch: boolean,
    checkMonths: number,
): string {
    if (kind === "licence_check" && checkMonths === 0) {
        return "Führerscheinkontrolle ist ausgeschaltet.";
    }

    if (hasSearch) {
        return "Keine Treffer für die Suche.";
    }

    if (kind === "licence_check" && state === "missing") {
        return "Eine fehlende Kontrolle steht unter Überfällig.";
    }

    if (state === "missing") {
        return "Alle Daten sind eingetragen.";
    }

    if (state === "soon") {
        return "Nichts im Vorlauf.";
    }

    return kind === "licence_expiry"
        ? "Kein Führerschein abgelaufen."
        : "Nichts überfällig.";
}

/** Fixed heights in px of the overview parts. `DueBoard.module.scss` uses the same. */
export const DUE_LIST_SIZES = { head: 40, row: 48, more: 40, calm: 40 };

/**
 * Rows per kind so the overview fills `height` without scrolling. Kinds without
 * entries share one line. Every kind with entries gets one row, then one more
 * each in turn (page order first). A kind not shown completely needs its
 * "Alle anzeigen" line, so the budget is recounted once that is known.
 */
export function allocateDueRows(
    totals: ReadonlyArray<{ kind: DueKind; total: number }>,
    height: number,
): Partial<Record<DueKind, number>> {
    const { head, row, more: moreHeight, calm } = DUE_LIST_SIZES;
    const filled = totals.filter((entry) => entry.total > 0);
    const fixed =
        filled.length * head + (filled.length < totals.length ? calm : 0);
    const alloc: Partial<Record<DueKind, number>> = {};
    let partial = filled.length;

    for (let pass = 0; pass < 3; pass += 1) {
        let budget = Math.max(
            filled.length,
            Math.floor((height - fixed - partial * moreHeight) / row),
        );

        for (const entry of filled) {
            alloc[entry.kind] = 0;
        }

        let progress = true;
        while (budget > 0 && progress) {
            progress = false;

            for (const entry of filled) {
                const current = alloc[entry.kind] ?? 0;

                if (budget > 0 && current < entry.total) {
                    alloc[entry.kind] = current + 1;
                    budget -= 1;
                    progress = true;
                }
            }
        }

        partial = filled.filter(
            (entry) => (alloc[entry.kind] ?? 0) < entry.total,
        ).length;
    }

    return alloc;
}

export function dueRowLink(row: DueListItem): string | null {
    if (row.vehicle_id !== null) {
        return `/vehicles/${row.vehicle_id}`;
    }

    return row.driver_id !== null ? `/drivers/${row.driver_id}` : null;
}
