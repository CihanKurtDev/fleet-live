/**
 * Katalog der Fristen. Die Oberfläche zeigt `basis` erst bei `verified === true`.
 * Eine interne Regel zeigt den Hinweis auch ohne geprüfte Rechtsquelle.
 */

import { z } from "zod";

export const DUE_RULE_IDS = [
    "hu",
    "uvv",
    "licence_expiry",
    "licence_check",
] as const;

export type DueRuleId = (typeof DUE_RULE_IDS)[number];

export type DueRuleScope = "vehicle" | "driver";

export type DueCalculation = "month_end" | "last_plus_months" | "stored_date";

export type DueRuleKind = "statutory" | "recommended" | "internal";

export type DueWhenEmpty = "missing" | "overdue";

export type DueRule = {
    id: DueRuleId;
    scope: DueRuleScope;
    /** `null`, wenn kein Intervall gerechnet wird. */
    interval_months: number | null;
    calculation: DueCalculation;
    /** Rechtsquelle. Erst anzeigen, wenn `verified` true ist. */
    basis: string;
    rule_kind: DueRuleKind;
    lead_days: number;
    verified: boolean;
    when_empty: DueWhenEmpty;
};

/** Steht an der internen Führerscheinkontrolle, unabhängig von `verified`. */
export const INTERNAL_DUE_NOTICE = "Interne Vorgabe, keine gesetzliche Frist";

export const DUE_RULES: readonly DueRule[] = [
    {
        id: "hu",
        scope: "vehicle",
        interval_months: null,
        calculation: "month_end",
        basis: "StVZO § 29, Anlage VIII",
        rule_kind: "statutory",
        lead_days: 30,
        verified: false,
        when_empty: "missing",
    },
    {
        id: "uvv",
        scope: "vehicle",
        interval_months: 12,
        calculation: "last_plus_months",
        basis: "DGUV Vorschrift 70 § 57",
        rule_kind: "statutory",
        lead_days: 30,
        verified: false,
        when_empty: "missing",
    },
    {
        id: "licence_expiry",
        scope: "driver",
        interval_months: null,
        calculation: "stored_date",
        basis: "FeV § 23 Abs. 1 Satz 2, Anlage 9 Spalte 11",
        rule_kind: "statutory",
        lead_days: 30,
        verified: false,
        when_empty: "missing",
    },
    {
        id: "licence_check",
        scope: "driver",
        interval_months: 6,
        calculation: "last_plus_months",
        basis: "StVG § 21 Abs. 1 Nr. 2, Abs. 2 Nr. 2",
        rule_kind: "internal",
        lead_days: 30,
        verified: false,
        when_empty: "overdue",
    },
];

export function dueRule(id: DueRuleId): DueRule {
    const rule = DUE_RULES.find((entry) => entry.id === id);

    if (!rule) {
        throw new Error(`Unbekannte Frist: ${id}`);
    }

    return rule;
}

/** Monat 01–12. Der Tag gehört nicht in ein HU-Monatsfeld. */
export const yearMonthSchema = z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Monat als JJJJ-MM angeben.");

/** Vorlauf in Tagen. 0 heißt: nur der Fälligkeitstag selbst ist „bald“. */
export const dueLeadDaysSchema = z
    .number()
    .int("Vorlauf in ganzen Tagen angeben.")
    .min(0, "Vorlauf darf nicht negativ sein.");

/** 0 schaltet die Führerscheinkontrolle aus. */
export const licenceCheckMonthsSchema = z
    .number()
    .int("Kontrollintervall in ganzen Monaten angeben.")
    .min(0, "Kontrollintervall darf nicht negativ sein.")
    .max(24, "Kontrollintervall darf höchstens 24 Monate sein.");
