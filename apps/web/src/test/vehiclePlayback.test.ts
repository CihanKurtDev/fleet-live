import { describe, expect, it } from "vitest";

import {
    MAX_DELAY_MS,
    MAX_RATE,
    MIN_DELAY_MS,
    VehiclePlayback,
    type PlaybackReport,
    type RoadPoint,
} from "../components/vehicles/vehiclePlayback";

/*
 * Device time and the browser's clock in these tests: the device clock is
 * `T0 + τ`, the browser's `performance.now()` is `τ + network delay`. A report
 * stamped τ therefore arrives at local time τ + net.
 */
const T0 = Date.UTC(2026, 9, 23, 10, 0, 0);
const stamp = (deviceMs: number) =>
    new Date(T0 + deviceMs).toISOString().replace("T", " ").replace("Z", "");

const M_PER_DEG = 111_320;
const COS = Math.cos((50 * Math.PI) / 180);
/** A road 2 km north from (50, 7), then east: the corner tests "along the road, not across". */
const CORNER_M = 2_000;
const roadAt = (s: number): RoadPoint =>
    s <= CORNER_M
        ? { lat: 50 + s / M_PER_DEG, lng: 7 }
        : {
              lat: 50 + CORNER_M / M_PER_DEG,
              lng: 7 + (s - CORNER_M) / (M_PER_DEG * COS),
          };
/** Distance along the road and distance off it, in metres. */
const project = (point: { lat: number; lng: number }) => {
    const north = (point.lat - 50) * M_PER_DEG;
    const east = (point.lng - 7) * M_PER_DEG * COS;
    const offNorthLeg = Math.hypot(east, Math.max(0, north - CORNER_M, -north));
    const offEastLeg = Math.hypot(north - CORNER_M, Math.min(0, east));

    return offNorthLeg <= offEastLeg
        ? { s: Math.min(north, CORNER_M), off: offNorthLeg }
        : { s: CORNER_M + Math.max(0, east), off: offEastLeg };
};
/** Road points every 25 m strictly between two distances (the corner is one of them). */
const roadBetween = (from: number, to: number) => {
    const points: RoadPoint[] = [];

    for (let s = Math.floor(from / 25) * 25 + 25; s < to; s += 25) {
        points.push(roadAt(s));
    }

    return points;
};

const SPEED = 20; // m/s, 72 km/h
const GAPS = [5000, 3200, 7800, 4100, 6300, 3000, 8000, 5500, 4700, 6900];
const NETS = [40, 900, 120, 1500, 60, 300, 0, 1100];

type Frame = {
    now: number;
    s: number;
    off: number;
    age: number | null;
    done: boolean;
    estimated: boolean;
};

type Drive = {
    until: number;
    gaps?: number[];
    nets?: number[];
    /** Report numbers that never arrive. */
    drop?: ReadonlySet<number>;
    /** Local times without a frame (tab in the background). */
    noFramesBetween?: [number, number];
    frameMs?: number;
    speed?: number;
    recordedAt?: (deviceMs: number, index: number) => string;
};

const playbackForTest = () => new VehiclePlayback({ clockOffset: () => T0 });

/** Plays one vehicle: reports and frames in local time order. */
const drive = (playback: VehiclePlayback, options: Drive) => {
    const {
        until,
        gaps = GAPS,
        nets = NETS,
        drop = new Set<number>(),
        noFramesBetween,
        frameMs = 16,
        speed = SPEED,
        recordedAt = stamp,
    } = options;
    const reports: { arrive: number; device: number; index: number }[] = [];
    let device = 0;

    for (let index = 0; device <= until; index += 1) {
        if (!drop.has(index)) {
            reports.push({
                arrive: device + nets[index % nets.length]!,
                device,
                index,
            });
        }
        device += gaps[index % gaps.length]!;
    }
    reports.sort((a, b) => a.arrive - b.arrive);

    const frames: Frame[] = [];
    let lastS = 0;
    let next = 0;

    for (let now = 0; now <= until; now += frameMs) {
        while (next < reports.length && reports[next]!.arrive <= now) {
            const { device: at, index } = reports[next]!;
            const s = (speed * at) / 1000;

            playback.report(
                1,
                {
                    ...roadAt(s),
                    recordedAt: recordedAt(at, index),
                    road: index === 0 ? [] : roadBetween(lastS, s),
                },
                reports[next]!.arrive,
            );
            lastS = s;
            next += 1;
        }

        if (
            noFramesBetween &&
            now > noFramesBetween[0] &&
            now < noFramesBetween[1]
        ) {
            continue;
        }

        const shown = playback.at(1, now);

        if (shown) {
            frames.push({
                now,
                ...project(shown),
                age: shown.age,
                done: shown.done,
                estimated: shown.estimated,
            });
        }
    }

    return frames;
};

const after = (frames: Frame[], from: number, to = Infinity) =>
    frames.filter((frame) => frame.now >= from && frame.now <= to);

/** Speed between frames, in m/s. */
const speeds = (frames: Frame[]) =>
    frames.slice(1).map((frame, index) => {
        const previous = frames[index]!;

        return ((frame.s - previous.s) * 1000) / (frame.now - previous.now);
    });

const expectNoStandstill = (frames: Frame[], windowMs = 250) => {
    for (let index = 0; index < frames.length; index += 1) {
        const start = frames[index]!;
        const end = frames.find((frame) => frame.now >= start.now + windowMs);

        if (!end) {
            break;
        }

        expect(end.s - start.s).toBeGreaterThan(
            (0.4 * SPEED * windowMs) / 1000,
        );
    }
};

const expectNoJump = (frames: Frame[]) => {
    const fastest = Math.max(...speeds(frames));

    // At most the catch-up speed; a jump would be a huge speed for one frame.
    expect(fastest).toBeLessThanOrEqual(SPEED * MAX_RATE * 1.05 + 1);
    expect(Math.min(...speeds(frames))).toBeGreaterThanOrEqual(0);
};

describe("VehiclePlayback: buffer", () => {
    it("knows nothing of a vehicle that never reported", () => {
        const playback = playbackForTest();

        expect(playback.at(1, 0)).toBeUndefined();
        expect(playback.canPlay(1)).toBe(false);
    });

    it("shows a single report where it was and does not invent motion", () => {
        const playback = playbackForTest();

        playback.report(1, { ...roadAt(0), recordedAt: stamp(0) }, 0);

        const first = playback.at(1, 0)!;
        const later = playback.at(1, 5_000)!;

        expect(project(first).s).toBeCloseTo(0, 6);
        expect(project(later).s).toBeCloseTo(0, 6);
        expect(later.done).toBe(true);
        expect(playback.canPlay(1)).toBe(false);
    });

    it("moves on from the first stretch instead of waiting for a full buffer", () => {
        const playback = playbackForTest();
        const frames = drive(playback, { until: 6_000, nets: [0] });

        // The second report arrives at 5 s; the dot moves within half a second.
        const moving = frames.find(
            (frame) => frame.now >= 5_000 && frame.s > 0.5,
        );

        expect(moving!.now).toBeLessThan(5_500);
    });

    it("moves without standing still at 3–8 s gaps with network jitter", () => {
        const frames = drive(playbackForTest(), { until: 120_000 });
        const steady = after(frames, 40_000);

        expectNoStandstill(steady);
        expectNoJump(steady);

        for (const frame of steady) {
            expect(frame.off).toBeLessThan(0.5);
        }
    });

    it("keeps the speed of the device time, not of the arrival time", () => {
        const frames = drive(playbackForTest(), { until: 120_000 });
        const steady = after(frames, 40_000);
        const elapsed = steady[steady.length - 1]!.now - steady[0]!.now;
        const covered = steady[steady.length - 1]!.s - steady[0]!.s;

        // Over a minute the dot covers what the vehicle drove, within 5 %.
        expect(covered / ((SPEED * elapsed) / 1000)).toBeGreaterThan(0.95);
        expect(covered / ((SPEED * elapsed) / 1000)).toBeLessThan(1.05);
    });

    it("plays a time-stamped position: the age shown is the delay behind the device", () => {
        const playback = playbackForTest();
        const frames = drive(playback, { until: 120_000, nets: [0] });
        const last = frames[frames.length - 1]!;
        const delay = playback.delay(1)!;

        expect(delay).toBeGreaterThanOrEqual(MIN_DELAY_MS);
        expect(delay).toBeLessThanOrEqual(MAX_DELAY_MS);
        // Shown where the vehicle was `age` ago, on the device clock.
        expect(last.s).toBeCloseTo((SPEED * (last.now - last.age!)) / 1000, 0);
        expect(Math.abs(last.age! - delay)).toBeLessThan(500);
        expect(last.estimated).toBe(false);
    });

    it("brakes softly for a missed report and catches up without a jump", () => {
        const playback = playbackForTest();
        // Report 12 comes at about 65 s.
        const frames = drive(playback, { until: 140_000, drop: new Set([12]) });
        const around = after(frames, 40_000);

        expectNoJump(around);

        // Never from driving to standing within half a second.
        for (const frame of around) {
            const later = around.find((item) => item.now >= frame.now + 500);
            const before = around.filter(
                (item) => item.now >= frame.now - 100 && item.now <= frame.now,
            );
            const after500 = around.filter(
                (item) => later && item.now >= later.now && item.now <= later.now + 100,
            );

            if (before.length > 1 && after500.length > 1) {
                const v0 = Math.max(...speeds(before));
                const v1 = Math.max(...speeds(after500));

                if (v0 > 0.8 * SPEED) {
                    expect(v1).toBeGreaterThan(0.1 * SPEED);
                }
            }
        }

        // Back on its delay a while later.
        const end = frames[frames.length - 1]!;
        expect(Math.abs(end.age! - playback.delay(1)!)).toBeLessThan(500);
    });

    it("rides out several missed reports without a jump", () => {
        const playback = playbackForTest();
        const frames = drive(playback, {
            until: 160_000,
            drop: new Set([12, 13, 14]),
        });

        expectNoJump(after(frames, 40_000));

        const end = frames[frames.length - 1]!;
        expect(Math.abs(end.age! - playback.delay(1)!)).toBeLessThan(500);
    });

    it("starts again from the new data after a long silence instead of crawling after it", () => {
        const playback = playbackForTest();
        // About 60 s without a report from 65 s on.
        const frames = drive(playback, {
            until: 160_000,
            gaps: [5_000],
            nets: [0],
            drop: new Set([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]),
        });
        // The report after the silence arrives at 125 s.
        const back = frames.find((frame) => frame.now >= 125_500)!;

        expect(back.age!).toBeLessThanOrEqual(MAX_DELAY_MS + 500);
    });

    it("never runs past the newest report into an unknown road", () => {
        const playback = playbackForTest();
        // Reports stop at 60 s.
        const frames = drive(playback, {
            until: 90_000,
            gaps: [5_000],
            nets: [0],
            drop: new Set(Array.from({ length: 30 }, (_, index) => 13 + index)),
        });
        const newest = (SPEED * 60_000) / 1000;

        for (const frame of frames) {
            expect(frame.s).toBeLessThanOrEqual(newest + 1e-6);
        }
        expect(frames[frames.length - 1]!.done).toBe(true);
        expect(frames[frames.length - 1]!.s).toBeCloseTo(newest, 3);
    });

    it("ignores a duplicate report and does not lay its road twice", () => {
        const once = playbackForTest();
        const twice = playbackForTest();

        for (const playback of [once, twice]) {
            playback.report(1, { ...roadAt(0), recordedAt: stamp(0) }, 0);
            playback.report(
                1,
                { ...roadAt(100), recordedAt: stamp(5_000), road: roadBetween(0, 100) },
                5_000,
            );
        }

        expect(
            twice.report(
                1,
                { ...roadAt(100), recordedAt: stamp(5_000), road: roadBetween(0, 100) },
                5_200,
            ),
        ).toBe(false);

        for (let now = 5_000; now < 20_000; now += 16) {
            expect(twice.at(1, now)).toEqual(once.at(1, now));
        }
    });

    it("drops a report older than the newest one instead of driving back", () => {
        const playback = playbackForTest();

        playback.report(1, { ...roadAt(0), recordedAt: stamp(0) }, 0);
        playback.report(1, { ...roadAt(200), recordedAt: stamp(10_000), road: roadBetween(0, 200) }, 10_000);

        expect(
            playback.report(1, { ...roadAt(100), recordedAt: stamp(5_000) }, 10_100),
        ).toBe(false);

        let farthest = 0;

        for (let now = 10_000; now < 40_000; now += 16) {
            const { s } = project(playback.at(1, now)!);

            expect(s).toBeGreaterThanOrEqual(farthest - 1e-9);
            farthest = s;
        }
        expect(farthest).toBeCloseTo(200, 3);
    });

    it("falls back to the arrival time for a missing or broken device time and says so", () => {
        const playback = playbackForTest();
        const frames = drive(playback, {
            until: 60_000,
            gaps: [5_000],
            nets: [0],
            recordedAt: (device, index) => (index >= 6 ? "kaputt" : stamp(device)),
        });
        const late = after(frames, 45_000);

        expectNoStandstill(late);
        expect(late.every((frame) => Number.isFinite(frame.s))).toBe(true);
        expect(late[late.length - 1]!.estimated).toBe(true);
    });

    it("reads device times in seconds and in milliseconds the same way", () => {
        const seconds = playbackForTest();
        const millis = playbackForTest();
        const run = (playback: VehiclePlayback, format: (ms: number) => string) =>
            drive(playback, {
                until: 40_000,
                gaps: [5_000],
                nets: [0],
                recordedAt: format,
            });

        expect(run(seconds, (ms) => stamp(ms).slice(0, 19))).toEqual(
            run(millis, stamp),
        );
    });

    it("treats a device clock far off the arrival time as unreliable", () => {
        const playback = playbackForTest();
        const frames = drive(playback, {
            until: 60_000,
            gaps: [5_000],
            nets: [0],
            // One report claims to be from the next day.
            recordedAt: (device, index) =>
                stamp(index === 7 ? device + 86_400_000 : device),
        });

        expectNoJump(after(frames, 20_000));
        expect(frames[frames.length - 1]!.age!).toBeLessThanOrEqual(MAX_DELAY_MS + 500);
    });

    it("stands still while a vehicle reports the same place", () => {
        const playback = playbackForTest();

        for (let index = 0; index < 6; index += 1) {
            playback.report(1, { ...roadAt(50), recordedAt: stamp(index * 5_000) }, index * 5_000);
        }

        for (let now = 25_000; now < 40_000; now += 100) {
            const shown = playback.at(1, now)!;

            expect(project(shown).s).toBeCloseTo(50, 6);
        }
        expect(playback.at(1, 40_000)!.done).toBe(true);
    });

    it("plays the right place after a long frame pause (tab in the background)", () => {
        const playback = playbackForTest();
        const frames = drive(playback, {
            until: 100_000,
            gaps: [5_000],
            nets: [0],
            noFramesBetween: [60_000, 80_000],
        });
        const resumed = frames.find((frame) => frame.now >= 80_000)!;

        // Where the vehicle was `delay` ago, not at the newest report.
        expect(resumed.age!).toBeGreaterThanOrEqual(MIN_DELAY_MS - 50);
        expect(resumed.s).toBeCloseTo((SPEED * (resumed.now - resumed.age!)) / 1000, 0);
        expectNoJump(after(frames, 80_000));
    });
});

describe("VehiclePlayback: delay", () => {
    const delayFor = (gap: number) => {
        const playback = playbackForTest();

        drive(playback, { until: 20 * gap, gaps: [gap], nets: [0], frameMs: 200 });
        return playback.delay(1)!;
    };

    it("grows with the gaps between reports and stays within its bounds", () => {
        expect(delayFor(1_000)).toBe(MIN_DELAY_MS);
        expect(delayFor(3_000)).toBeLessThan(delayFor(5_000));
        expect(delayFor(5_000)).toBeLessThan(MAX_DELAY_MS);
        expect(delayFor(20_000)).toBe(MAX_DELAY_MS);
    });

    it("grows with irregular gaps and network jitter", () => {
        const regular = playbackForTest();
        const jittery = playbackForTest();

        drive(regular, { until: 100_000, gaps: [5_500], nets: [0], frameMs: 200 });
        drive(jittery, { until: 100_000, frameMs: 200 });

        expect(jittery.delay(1)!).toBeGreaterThan(regular.delay(1)!);
    });

    it("comes down again when reports come more often", () => {
        const playback = playbackForTest();

        drive(playback, {
            until: 200_000,
            gaps: [...Array(15).fill(8_000), ...Array(60).fill(2_000)],
            nets: [0],
            frameMs: 200,
        });

        expect(playback.delay(1)!).toBeLessThan(4_000);
    });
});

describe("VehiclePlayback: geometry", () => {
    it("spreads the time over the road by distance, not by point", () => {
        const playback = playbackForTest();

        playback.report(1, { ...roadAt(0), recordedAt: stamp(0) }, 0);
        playback.report(1, { ...roadAt(100), recordedAt: stamp(10_000), road: [roadAt(10)] }, 10_000);

        let crossed: number | null = null;

        for (let now = 10_000; now < 30_000 && crossed === null; now += 10) {
            const shown = playback.at(1, now)!;

            if (project(shown).s >= 10) {
                // Device time of the shown position.
                crossed = now - shown.age! ;
            }
        }

        // 10 of 100 m: a tenth of the 10 s, not half of them.
        expect(crossed).toBeGreaterThan(900);
        expect(crossed).toBeLessThan(1_100);
    });

    it("follows the road around a bend instead of the straight line", () => {
        const frames = drive(playbackForTest(), {
            until: 200_000,
            gaps: [10_000],
            nets: [0],
            speed: 25,
        });
        const atBend = frames.filter(
            (frame) => frame.s > CORNER_M - 150 && frame.s < CORNER_M + 150,
        );

        expect(atBend.length).toBeGreaterThan(10);

        for (const frame of atBend) {
            expect(frame.off).toBeLessThan(0.5);
        }
    });

    it("handles identical and very close road points", () => {
        const playback = playbackForTest();

        playback.report(1, { ...roadAt(0), recordedAt: stamp(0) }, 0);
        playback.report(
            1,
            {
                ...roadAt(100),
                recordedAt: stamp(5_000),
                road: [roadAt(10), roadAt(10), roadAt(10.001), roadAt(50)],
            },
            5_000,
        );

        for (let now = 5_000; now < 20_000; now += 16) {
            const shown = playback.at(1, now)!;

            expect(Number.isFinite(shown.lat) && Number.isFinite(shown.lng)).toBe(true);
            expect(project(shown).off).toBeLessThan(1e-6);
        }
    });

    it("looks ahead only as far as the newest report", () => {
        const playback = playbackForTest();

        playback.report(1, { ...roadAt(0), recordedAt: stamp(0) }, 0);
        playback.report(1, { ...roadAt(100), recordedAt: stamp(5_000), road: roadBetween(0, 100) }, 5_000);

        const ahead = playback.ahead(1, 5_000, 60_000)!;

        expect(project(ahead).s).toBeCloseTo(100, 6);
    });
});

describe("VehiclePlayback: trips", () => {
    it("carries on into a new trip that starts where the last one ended", () => {
        const playback = playbackForTest();
        const reports: [number, PlaybackReport][] = [
            [0, { ...roadAt(0), recordedAt: stamp(0) }],
            [5_000, { ...roadAt(100), recordedAt: stamp(5_000), road: roadBetween(0, 100) }],
            [
                10_000,
                {
                    ...roadAt(200),
                    recordedAt: stamp(10_000),
                    road: [roadAt(100), ...roadBetween(100, 200)],
                    newTrip: true,
                },
            ],
        ];

        let previous = 0;

        for (let now = 0; now < 30_000; now += 16) {
            while (reports.length > 0 && reports[0]![0] <= now) {
                const [arrive, report] = reports.shift()!;

                playback.report(1, report, arrive);
            }

            const { s } = project(playback.at(1, now)!);

            expect(s - previous).toBeLessThan(5);
            previous = s;
        }
        expect(previous).toBeCloseTo(200, 3);
    });

    it("jumps to a new trip far away and starts its line from nothing", () => {
        const playback = playbackForTest();

        playback.report(1, { ...roadAt(0), recordedAt: stamp(0) }, 0);
        playback.report(1, { ...roadAt(100), recordedAt: stamp(5_000), road: roadBetween(0, 100) }, 5_000);

        const far = { lat: 52.5, lng: 13.4 };

        playback.report(
            1,
            { ...far, recordedAt: stamp(10_000), road: [{ lat: 52.49, lng: 13.39 }], newTrip: true },
            10_000,
        );

        expect(playback.at(1, 10_000)).toMatchObject({ ...far, done: true });
    });

    it("counts the points of the line behind the shown position, per trip", () => {
        const playback = playbackForTest();
        const line = [0, 25, 50, 75, 100].map(roadAt);

        playback.report(1, { ...line[0]!, recordedAt: stamp(0) }, 0);
        playback.report(1, { ...line[4]!, recordedAt: stamp(10_000), road: line.slice(1, 4) }, 10_000);

        const passed: number[] = [];

        for (let now = 10_000; now < 40_000; now += 16) {
            passed.push(playback.at(1, now)!.passed);
        }

        expect(passed[0]).toBe(1);
        expect(passed[passed.length - 1]).toBe(5);
        expect([...passed].sort((a, b) => a - b)).toEqual(passed);
    });
});

describe("VehiclePlayback: history", () => {
    const history = (until: number, gap = 5_000) => {
        const fixes = [];

        for (let device = 0; device <= until; device += gap) {
            fixes.push({ ...roadAt((SPEED * device) / 1000), recordedAt: stamp(device) });
        }

        return fixes;
    };
    const line = (until: number) => {
        const end = (SPEED * until) / 1000;
        const along: number[] = [];

        for (let s = 0; s < end; s += 25) {
            along.push(s);
        }

        return [...along, end].map(roadAt);
    };

    it("moves at once when it starts from the stored history and the open trip", () => {
        const playback = playbackForTest();
        const opened = 40_300;

        playback.seed(1, history(40_000), line(40_000), opened);

        const first = playback.at(1, opened)!;
        const soon = playback.at(1, opened + 300)!;

        expect(first.done).toBe(false);
        expect(project(soon).s - project(first).s).toBeGreaterThan(SPEED * 0.2);
        expect(project(first).off).toBeLessThan(0.5);
        // A little in the past, never at the newest point already.
        expect(first.age!).toBeGreaterThanOrEqual(MIN_DELAY_MS);
        expect(first.age!).toBeLessThanOrEqual(MAX_DELAY_MS + 300);
        // The line behind the dot ends before it.
        expect(first.passed).toBeGreaterThan(1);
        expect(first.passed).toBeLessThan(line(40_000).length);
    });

    it("goes on from the history into the live reports without a jump", () => {
        const playback = playbackForTest();

        playback.seed(1, history(40_000), line(40_000), 40_300);

        let previous = project(playback.at(1, 40_300)!).s;
        let lastS = (SPEED * 40_000) / 1000;

        for (let now = 40_316; now < 90_000; now += 16) {
            if (now % 5_000 < 16 && now > 45_000) {
                const device = now - (now % 5_000);
                const s = (SPEED * device) / 1000;

                playback.report(
                    1,
                    { ...roadAt(s), recordedAt: stamp(device), road: roadBetween(lastS, s) },
                    now,
                );
                lastS = s;
            }

            const { s } = project(playback.at(1, now)!);

            expect(s - previous).toBeGreaterThanOrEqual(0);
            expect(s - previous).toBeLessThan(SPEED * MAX_RATE * 0.016 * 1.05 + 0.5);
            previous = s;
        }
    });

    it("uses the fixes alone, in a straight line, when no trip line is known", () => {
        const playback = playbackForTest();

        playback.seed(1, history(40_000), [], 40_300);

        expect(playback.canPlay(1)).toBe(true);
        expect(playback.at(1, 40_300)!.done).toBe(false);
    });

    it("ignores broken and unsorted history rows", () => {
        const playback = playbackForTest();
        const fixes = history(40_000).reverse();

        fixes.push({ lat: Number.NaN, lng: 7, recordedAt: stamp(20_000) });
        fixes.push({ ...roadAt(0), recordedAt: "nicht lesbar" });

        playback.seed(1, fixes, line(40_000), 40_300);

        const shown = playback.at(1, 40_300)!;

        expect(Number.isFinite(shown.lat)).toBe(true);
        expect(shown.done).toBe(false);
    });
});

describe("VehiclePlayback: several vehicles", () => {
    it("gives a group the middle of its members as they are shown now", () => {
        const playback = playbackForTest();

        playback.report(1, { lat: 50, lng: 7, recordedAt: stamp(0) }, 0);
        playback.report(2, { lat: 50.2, lng: 7.2, recordedAt: stamp(0) }, 0);

        expect(playback.centre([1, 2, 3], 0)).toMatchObject({ lat: 50.1, lng: 7.1 });
        expect(playback.centre([3], 0)).toBeUndefined();
    });

    it("forgets vehicles that left the map", () => {
        const playback = playbackForTest();

        playback.report(1, { lat: 50, lng: 7, recordedAt: stamp(0) }, 0);
        playback.report(2, { lat: 51, lng: 7, recordedAt: stamp(0) }, 0);
        playback.retain(new Set([2]));

        expect(playback.at(1, 0)).toBeUndefined();
        expect(playback.at(2, 0)).toBeDefined();

        playback.forget(2);
        expect(playback.at(2, 0)).toBeUndefined();
    });

    it("jumps to every report when motion is reduced", () => {
        const playback = playbackForTest();

        playback.report(1, { lat: 50, lng: 7, recordedAt: stamp(0) }, 0);
        playback.report(1, { lat: 50.01, lng: 7, recordedAt: stamp(5_000), jump: true }, 5_000);

        expect(playback.at(1, 5_000)).toMatchObject({ lat: 50.01, lng: 7, done: true });
    });

    it("keeps its buffer small over a long drive", () => {
        const playback = playbackForTest();

        drive(playback, { until: 600_000, frameMs: 100 });

        expect(playback.size(1)!).toBeLessThan(200);
    });
});
