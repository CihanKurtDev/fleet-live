import { formatAlertDuration } from "@fleet-live/shared";
import type { TripEvent } from "@fleet-live/shared";

import { parseSqliteUtc } from "../../utils/dateTime";

/** Kilometres with one decimal, German style. */
export const formatKm = (meters: number) =>
    (meters / 1_000).toLocaleString("de-DE", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
    });

/** Seconds between two stored times, or null while it runs. */
export const eventSeconds = (
    event: Pick<TripEvent, "started_at" | "ended_at">,
): number | null => {
    const start = parseSqliteUtc(event.started_at)?.getTime();
    const end =
        event.ended_at === null
            ? undefined
            : parseSqliteUtc(event.ended_at)?.getTime();

    return start === undefined || end === undefined
        ? null
        : Math.max(0, (end - start) / 1000);
};

/** How far over the limit the run went, in km/h. */
export const overLimit = (event: TripEvent): number | null =>
    event.max_speed_kmh !== null && event.limit_kmh !== null
        ? Math.round(event.max_speed_kmh - event.limit_kmh)
        : null;

/** A duration that does not break between number and unit. */
const duration = (seconds: number) =>
    formatAlertDuration(seconds).replace(" ", " ");

/** The headline of a speeding run: how far over the limit („+88 km/h“). */
export const eventHeadline = (event: TripEvent): string | null => {
    const over = overLimit(event);
    return event.type === "SPEEDING" && over !== null ? `+${over} km/h` : null;
};

/** What happened: the top speed against the limit, or the signal loss. */
export const eventDetail = (event: TripEvent): string => {
    if (event.type === "OFFLINE") {
        return "Fahrzeug sendete kein Signal";
    }

    const speed =
        event.max_speed_kmh !== null && event.limit_kmh !== null
            ? `${Math.round(event.max_speed_kmh)} km/h bei ${Math.round(event.limit_kmh)} erlaubt`
            : "Über dem Limit";

    return event.estimated && event.count > 1
        ? `${event.count} Überschreitungen, höchste ${speed}`
        : speed;
};

/** Where on the trip (a stretch, a point, a rough place) and for how long. */
export const eventWhere = (event: TripEvent): string => {
    if (event.estimated) {
        return `etwa bei km ${formatKm(event.from_m)} · Stelle geschätzt`;
    }

    const running = event.type === "SPEEDING" && event.ended_at === null;
    const place = running
        ? `ab km ${formatKm(event.from_m)}`
        : event.to_m !== null && event.to_m > event.from_m
          ? `km ${formatKm(event.from_m)}–${formatKm(event.to_m)}`
          : `bei km ${formatKm(event.from_m)}`;
    const seconds = eventSeconds(event);

    return `${place} · ${seconds === null ? "läuft" : duration(seconds)}`;
};

/** „3× · 2 Min.“: how often and how long the trip was too fast. */
export const speedingSummary = (events: readonly TripEvent[]): string => {
    const speeding = events.filter((event) => event.type === "SPEEDING");
    const count = speeding.reduce((sum, event) => sum + event.count, 0);

    if (count === 0) {
        return "nein";
    }

    const seconds = speeding.map(eventSeconds);
    const known =
        speeding.every((event) => !event.estimated) &&
        seconds.every((value) => value !== null);

    return known
        ? `${count}× · ${duration(
              seconds.reduce<number>((sum, value) => sum + (value ?? 0), 0),
          )}`
        : `${count}×`;
};
