import {
    WORKSHOP_REASON_LABELS,
    WORKSHOP_STATE_LABELS,
    berlinTodayIso,
    type WorkshopEvent,
    type WorkshopSummary,
    type WorkshopVisit,
} from "@fleet-live/shared";

import { formatIsoDate, formatYearMonth } from "../../utils/dateTime";

/** „31.10.“ for a date in the current year, else „31.10.2027“. */
export const shortDate = (iso: string): string => {
    const full = formatIsoDate(iso);
    return iso.slice(0, 4) === berlinTodayIso().slice(0, 4) ? full.slice(0, 6) : full;
};

/** „128,50 €“. */
export const formatEuro = (cents: number): string =>
    `${(cents / 100).toLocaleString("de-DE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })} €`;

/** A late return: in the workshop and past the expected day. */
export const isReturnLate = (visit: Pick<WorkshopSummary, "state" | "expected_on">) =>
    visit.state === "IN_WORKSHOP" &&
    visit.expected_on !== null &&
    visit.expected_on < berlinTodayIso();

/**
 * Two lines for the workshop cell of an HU/UVV row on /fristen. A stay for
 * another reason names it: „Wartung · Werkstatt Becker“.
 */
export const dueWorkshopText = (
    visit: WorkshopSummary,
    rowReason: "HU" | "UVV",
): { title: string; detail: string } => {
    const other = visit.reason !== rowReason ? `${WORKSHOP_REASON_LABELS[visit.reason]} · ` : "";

    return visit.state === "IN_WORKSHOP"
        ? {
              title: WORKSHOP_STATE_LABELS.IN_WORKSHOP,
              detail: other
                  ? `${other}${visit.place}`
                  : visit.expected_on
                    ? `fertig erwartet ${shortDate(visit.expected_on)}`
                    : visit.place,
          }
        : { title: `Termin ${shortDate(visit.planned_on)}`, detail: `${other}${visit.place}` };
};

/**
 * The second line of a Heute-dran row: „HU bei Prüfstelle Köln-Ost · heute ·
 * zuständig: du“.
 */
export const todayWorkshopLine = (visit: WorkshopVisit, meId: number | undefined) => {
    const today = berlinTodayIso();
    const when =
        visit.state === "IN_WORKSHOP"
            ? `fertig erwartet am ${formatIsoDate(visit.expected_on)}`
            : visit.planned_on === today
              ? "heute"
              : `Termin am ${formatIsoDate(visit.planned_on)}`;
    const who =
        visit.assignee_user_id !== null && visit.assignee_user_id === meId
            ? "zuständig: du"
            : visit.assignee_name
              ? `zuständig: ${visit.assignee_name}`
              : null;

    return [
        `${WORKSHOP_REASON_LABELS[visit.reason]} bei ${visit.place}`,
        when,
        who,
    ]
        .filter(Boolean)
        .join(" · ");
};

const FIELD_LABELS: Record<string, string> = {
    reason: "Grund",
    place: "Werkstatt",
    planned_on: "Termin",
    expected_on: "Fertig erwartet",
    assignee_user_id: "Zuständig",
    note: "Notiz",
};

/** One line of the stay's history. */
export const workshopEventText = (event: WorkshopEvent): string => {
    switch (event.action) {
        case "planned":
            return event.details?.planned_on
                ? `Geplant für ${shortDate(event.details.planned_on)}`
                : "Geplant";
        case "arrived":
            return "In der Werkstatt";
        case "updated":
            return `Geändert: ${(event.details?.fields ?? [])
                .map((field) => FIELD_LABELS[field] ?? field)
                .join(", ")}`;
        case "finished":
            return [
                "Fertig",
                event.details?.hu_due_on
                    ? `HU fällig ${formatYearMonth(event.details.hu_due_on)}`
                    : null,
                event.details?.cost_cents != null
                    ? formatEuro(event.details.cost_cents)
                    : null,
            ]
                .filter(Boolean)
                .join(" · ");
        case "cancelled":
            return "Abgesagt";
    }
};
