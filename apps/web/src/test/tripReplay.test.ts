import type { TripEvent } from "@fleet-live/shared";
import { describe, expect, it } from "vitest";

import {
    REPLAY_SECONDS,
    advanceReplay,
    drivenPart,
    isAtEvent,
    measureRoute,
    placeEvent,
    routeAt,
    routeBetween,
    shareOf,
} from "../components/vehicles/tripReplay";
import {
    eventDetail,
    eventHeadline,
    eventWhere,
    speedingSummary,
} from "../components/vehicles/tripEventText";

/** Three points on one meridian, 0.01° apart (about 1.1 km each). */
const route = measureRoute([
    { lat: 50.0, lng: 7.0 },
    { lat: 50.01, lng: 7.0 },
    { lat: 50.02, lng: 7.0 },
]);

const event = (overrides: Partial<TripEvent> = {}): TripEvent => ({
    id: 1,
    type: "SPEEDING",
    started_at: "2026-10-20 08:10:00",
    ended_at: "2026-10-20 08:11:00",
    from_m: 10_000,
    to_m: 14_000,
    max_speed_kmh: 92,
    limit_kmh: 50,
    estimated: false,
    count: 1,
    alert_id: 7,
    alert_open: true,
    ...overrides,
});

describe("trip replay", () => {
    it("plays a whole trip in the base time at 1× and stops at the end", () => {
        expect(advanceReplay(0, (REPLAY_SECONDS * 1000) / 2, 1)).toBeCloseTo(0.5);
        expect(advanceReplay(0, (REPLAY_SECONDS * 1000) / 4, 4)).toBeCloseTo(1);
        expect(advanceReplay(0.9, 60_000, 16)).toBe(1);
    });

    it("finds the point at a share of the distance", () => {
        expect(route.total).toBeGreaterThan(2_000);
        expect(routeAt(route, 0)).toEqual({ at: route.points[0], passed: 0 });

        const middle = routeAt(route, 0.25);
        expect(middle?.passed).toBe(1);
        expect(middle?.at.lat).toBeCloseTo(50.005, 6);

        expect(routeAt(route, 1)?.at).toEqual(route.points[2]);
    });

    it("draws the driven part up to the position", () => {
        expect(drivenPart(route, 0.75)).toEqual([
            route.points[0],
            route.points[1],
            { lat: expect.closeTo(50.015, 6), lng: 7.0 },
        ]);
        expect(drivenPart(measureRoute([]), 0.5)).toEqual([]);
    });

    it("cuts the stretch between two shares out of the line", () => {
        const stretch = routeBetween(route, 0.25, 0.75);

        expect(stretch).toHaveLength(3);
        expect(stretch[0]?.lat).toBeCloseTo(50.005, 6);
        expect(stretch[1]).toEqual(route.points[1]);
        expect(stretch[2]?.lat).toBeCloseTo(50.015, 6);
    });
});

describe("events on the trip", () => {
    it("places a run by its metres as shares of the trip", () => {
        expect(shareOf(10_000, 40_000)).toBe(0.25);
        expect(shareOf(50_000, 40_000)).toBe(1);
        expect(placeEvent(event(), 40_000)).toEqual({ from: 0.25, to: 0.35 });
    });

    it("draws no stretch for an estimated place, and a running run up to now", () => {
        expect(placeEvent(event({ estimated: true, to_m: null }), 40_000)).toEqual({
            from: 0.25,
            to: null,
        });
        expect(
            placeEvent(event({ ended_at: null, to_m: null }), 40_000),
        ).toEqual({ from: 0.25, to: 1 });
        expect(
            placeEvent(event({ type: "OFFLINE", to_m: 10_000 }), 40_000),
        ).toEqual({ from: 0.25, to: null });
    });

    it("is at a stretch while inside it, at a point only right there", () => {
        expect(isAtEvent({ from: 0.25, to: 0.35 }, 0.3)).toBe(true);
        expect(isAtEvent({ from: 0.25, to: 0.35 }, 0.36)).toBe(false);
        expect(isAtEvent({ from: 0.5, to: null }, 0.51)).toBe(true);
        expect(isAtEvent({ from: 0.5, to: null }, 0.53)).toBe(false);
    });
});

describe("event text", () => {
    it("says how far over the limit, where and how long", () => {
        expect(eventHeadline(event())).toBe("+42 km/h");
        expect(eventDetail(event())).toBe("92 km/h bei 50 erlaubt");
        expect(eventWhere(event())).toBe("km 10,0–14,0 · 1 Min.");
        expect(eventWhere(event({ ended_at: null, to_m: null }))).toBe(
            "ab km 10,0 · läuft",
        );
    });

    it("marks an estimated place and the overshoots it stands for", () => {
        const estimated = event({ estimated: true, to_m: null, count: 3 });

        expect(eventDetail(estimated)).toBe(
            "3 Überschreitungen, höchste 92 km/h bei 50 erlaubt",
        );
        expect(eventWhere(estimated)).toBe("etwa bei km 10,0 · Stelle geschätzt");
    });

    it("describes a signal loss as a point", () => {
        const offline = event({
            type: "OFFLINE",
            to_m: 10_000,
            max_speed_kmh: null,
            limit_kmh: null,
        });

        expect(eventHeadline(offline)).toBeNull();
        expect(eventDetail(offline)).toBe("Fahrzeug sendete kein Signal");
        expect(eventWhere(offline)).toBe("bei km 10,0 · 1 Min.");
    });

    it("sums how often and how long the trip was too fast", () => {
        expect(speedingSummary([])).toBe("nein");
        expect(speedingSummary([event(), event({ id: 2 })])).toBe("2× · 2 Min.");
        expect(speedingSummary([event({ estimated: true, count: 3 })])).toBe("3×");
    });
});
