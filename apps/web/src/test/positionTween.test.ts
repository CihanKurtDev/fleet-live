import { describe, expect, it } from "vitest";

import {
    MAX_REPORT_GAP_MS,
    PositionTweens,
} from "../components/vehicles/positionTween";

describe("PositionTweens", () => {
    it("shows a new vehicle where it was reported", () => {
        const tweens = new PositionTweens();

        tweens.report(1, 50, 7, 0);

        expect(tweens.at(1, 0)).toEqual({ lat: 50, lng: 7, done: true });
        expect(tweens.at(2, 0)).toBeUndefined();
    });

    it("plays the stretch to a report instead of jumping", () => {
        const tweens = new PositionTweens();

        tweens.report(1, 50, 7, 0);
        expect(tweens.report(1, 50.1, 7, 5_000)).toBe(true);

        const start = tweens.at(1, 5_000);
        const middle = tweens.at(1, 5_000 + 3_000);
        const end = tweens.at(1, 5_000 + 20_000);

        expect(start?.lat).toBeCloseTo(50, 6);
        expect(middle?.lat).toBeGreaterThan(50);
        expect(middle?.lat).toBeLessThan(50.1);
        expect(middle?.done).toBe(false);
        expect(end).toEqual({ lat: 50.1, lng: 7, done: true });
    });

    it("takes a little longer than the usual gap, so a late report finds it still moving", () => {
        const tweens = new PositionTweens();

        tweens.report(1, 50, 7, 0);
        tweens.report(1, 50.1, 7, 5_000);

        expect(tweens.heading(1)?.ms).toBeGreaterThan(5_000);
        expect(tweens.at(1, 5_000 + 5_000)?.done).toBe(false);
    });

    it("starts the next stretch from where the vehicle is shown, not from the last report", () => {
        const tweens = new PositionTweens();

        tweens.report(1, 50, 7, 0);
        tweens.report(1, 50.1, 7, 5_000);
        const early = tweens.at(1, 5_000 + 2_000);
        tweens.report(1, 50.2, 7, 5_000 + 2_000);

        expect(tweens.at(1, 5_000 + 2_000)?.lat).toBeCloseTo(early?.lat ?? 0, 9);
    });

    it("smooths irregular gaps", () => {
        const tweens = new PositionTweens();
        let now = 0;

        tweens.report(1, 50, 7, now);

        for (const gap of [3_000, 8_000, 3_000, 8_000]) {
            now += gap;
            tweens.report(1, 50 + now / 1e5, 7, now);
        }

        const ms = tweens.heading(1)?.ms ?? 0;

        // Between the shortest and the longest gap (times the lead), not either extreme.
        expect(ms).toBeGreaterThan(3_000 * 1.25);
        expect(ms).toBeLessThan(8_000 * 1.25);
    });

    it("shows a vehicle at once after a gap that was not motion", () => {
        const tweens = new PositionTweens();

        tweens.report(1, 50, 7, 0);

        expect(tweens.report(1, 51, 7, MAX_REPORT_GAP_MS + 1)).toBe(false);
        expect(tweens.at(1, MAX_REPORT_GAP_MS + 1)).toEqual({
            lat: 51,
            lng: 7,
            done: true,
        });
    });

    it("jumps when asked to (reduced motion)", () => {
        const tweens = new PositionTweens();

        tweens.report(1, 50, 7, 0);
        tweens.report(1, 50.1, 7, 5_000, true);

        expect(tweens.at(1, 5_000)).toEqual({ lat: 50.1, lng: 7, done: true });
    });

    it("gives a group the middle of its members as shown now, so it moves as evenly as they do", () => {
        const tweens = new PositionTweens();

        tweens.report(1, 50, 7, 0);
        tweens.report(2, 52, 9, 0);
        tweens.report(1, 50.2, 7, 5_000);
        tweens.report(2, 52.2, 9, 5_000);

        // Before the stretch starts the vehicles are still where they were.
        const before = tweens.centre([1, 2], 5_000);

        expect(before?.lat).toBeCloseTo(51, 9);
        expect(before?.lng).toBeCloseTo(8, 9);
        expect(tweens.centre([3], 0)).toBeUndefined();

        const early = tweens.centre([1, 2], 5_000 + 1_000);
        const late = tweens.centre([1, 2], 5_000 + 3_000);

        expect(early?.done).toBe(false);
        expect(late?.lat).toBeGreaterThan(early?.lat ?? 0);
        const settled = tweens.centre([1, 2, 99], 5_000 + 30_000);

        expect(settled?.lat).toBeCloseTo(51.2, 9);
        expect(settled?.done).toBe(true);
    });

    it("follows the road points between two reports instead of the straight line", () => {
        const tweens = new PositionTweens();

        tweens.report(1, 50, 7, 0);
        // A bend: north first, then east.
        tweens.report(1, 50.01, 7.01, 5_000, false, [
            { lat: 50.01, lng: 7 },
            { lat: 50.01, lng: 7.01 },
        ]);

        const ms = tweens.heading(1)?.ms ?? 0;
        // A third of the way (the first leg is 1.1 km, the second 0.7 km)
        // the dot is still on the northbound leg, not on the diagonal.
        const early = tweens.at(1, 5_000 + ms * 0.3);

        expect(early?.lng).toBeCloseTo(7, 9);
        expect(early?.lat).toBeGreaterThan(50);
        expect(tweens.at(1, 5_000 + ms)).toEqual({
            lat: 50.01,
            lng: 7.01,
            done: true,
        });
    });

    it("shows a new trip far away at once instead of sliding across the map", () => {
        const tweens = new PositionTweens();

        tweens.report(1, 50, 7, 0);
        tweens.report(1, 51, 8, 5_000, false, [{ lat: 51, lng: 7.99 }], true);

        expect(tweens.at(1, 5_000)).toEqual({ lat: 51, lng: 8, done: true });
    });

    it("ignores a report that changes nothing and forgets vehicles that left", () => {
        const tweens = new PositionTweens();

        tweens.report(1, 50, 7, 0);
        tweens.report(2, 51, 8, 0);

        expect(tweens.report(1, 50, 7, 5_000)).toBe(false);

        tweens.retain(new Set([2]));

        expect(tweens.at(1, 0)).toBeUndefined();
        expect(tweens.at(2, 0)).toBeDefined();
    });
});
