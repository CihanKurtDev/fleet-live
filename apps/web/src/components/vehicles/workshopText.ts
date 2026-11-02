import {
    workshopReasonsText,
    WORKSHOP_STATE_LABELS,
    berlinTodayIso,
    type WorkshopEvent,
    type WorkshopSummary,
    type WorkshopVisit,
} from "@fleet-live/shared";

import { formatIsoDate, formatYearMonth } from "../../utils/dateTime";
import { formatKm } from "./odometerText";

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
    const other = visit.reasons.includes(rowReason) ? "" : `${workshopReasonsText(visit.reasons)} · `;

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

const FIELD_LABELS: Record<string, string> = {
    reason: "Grund",
    reasons: "Was gemacht wird",
    transport: "Hinbringen",
    damage_ids: "Schäden",
    place: "Werkstatt",
    workshop_id: "Werkstatt",
    planned_on: "Termin",
    planned_time: "Uhrzeit",
    expected_on: "Fertig erwartet",
    bring_driver_id: "Bringt hin",
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
            return event.details?.by === "position"
                ? "Angekommen, erkannt an der Position"
                : "Angekommen, von Hand gemeldet";
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
                event.details?.odometer_km != null
                    ? `${formatKm(event.details.odometer_km)} laut Rechnung`
                    : null,
            ]
                .filter(Boolean)
                .join(" · ");
        case "cancelled":
            return "Abgesagt";
        case "picked_up":
            return "Abgeholt: hat die Werkstatt verlassen";
        case "cost_added":
            return event.details?.cost_cents != null
                ? `Kosten nachgetragen: ${formatEuro(event.details.cost_cents)}`
                : "Kosten nachgetragen";
    }
};

/** „heute, 08:00“, „03.11., 08:00“ or „03.11.“. */
/**
 * The driver to suggest when a stay needs one: who is to bring it, or, once
 * it is finished, who brought it.
 */
export const bringDriver = (
    visit: Pick<WorkshopVisit, "state" | "bring_driver_id"> | null,
): { id: number; note: string } | null =>
    visit?.bring_driver_id
        ? { id: visit.bring_driver_id, note: visit.state === "PLANNED" ? "bringt es hin" : "hat es hingebracht" }
        : null;

/** „heute“, else „30.10.“ (with the year when it is another one). */
export const dayText = (iso: string): string => (iso === berlinTodayIso() ? "heute" : shortDate(iso));

export const appointmentText = (visit: Pick<WorkshopSummary, "planned_on" | "planned_time">): string => {
    const day = dayText(visit.planned_on);
    return visit.planned_time ? `${day}, ${visit.planned_time}` : day;
};
