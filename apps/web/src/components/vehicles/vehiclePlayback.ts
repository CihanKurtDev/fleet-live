import { parseRecordedAt } from "@fleet-live/shared";

/**
 * Where a vehicle is shown right now, on the fleet map and the detail map.
 *
 * A tracker reports every few seconds, at irregular gaps, and the report
 * arrives some time after the device took it. The map does not chase the
 * newest report: it plays the reports back on the device clock, a little in
 * the past (`delay`), like a video buffer. Every report is a point in time
 * on the road; the road points that came with it (`path_delta`) get their
 * times by distance between the two reports. The shown position is always
 * between two known points, never ahead of the newest one: the road beyond
 * it is unknown (a detour, a jam), so nothing is predicted.
 *
 * - Device time (`recorded_at`, parsed by `parseRecordedAt`) sets the speed.
 *   Arrival time only measures how late reports come (network delay and
 *   jitter) and maps the browser's clock onto the device clock.
 * - The delay follows the smoothed gap between reports and how much gaps and
 *   arrivals vary (`MIN_DELAY_MS`–`MAX_DELAY_MS`). With it the next report is
 *   normally there before the shown position needs it.
 * - A missed report: the shown position brakes softly towards the newest
 *   point and waits there; the next report lets it go on and catch up, at
 *   most `MAX_RATE` times the real speed. A gap longer than `MAX_GAP_MS`, a
 *   lag over `MAX_BEHIND_MS` or a long pause of the frames (tab in the
 *   background) starts again at the right place instead of crawling after it.
 * - Dots, group symbols, the follow camera and the detail map's trail all
 *   read this one position. The class knows neither React nor Leaflet; the
 *   caller passes the clock (`performance.now()`), so tests can drive it.
 */

/** The shown position is at least this far behind the device. */
export const MIN_DELAY_MS = 2_000;
/** …and at most this far, whatever the gaps. */
export const MAX_DELAY_MS = 10_000;
/** Catching up after a missed report never runs faster than this. */
export const MAX_RATE = 1.5;
/** Steering to a longer delay slows down to at most this. */
const MIN_RATE = 0.75;
/** A lag of this many ms behind the target changes the rate by 1. */
const STEER_MS = 4_000;
/** Closer than this to the newest point, the shown position brakes. */
const BRAKE_MS = 1_000;
/** After braking, the rate grows by at most 1 per second. */
const ACCEL_PER_MS = 1 / 1_000;
/** Frames further apart than this are a pause (background tab), not motion. */
const FRAME_STALL_MS = 1_000;
/** Further behind than this, catching up would take too long: start again. */
export const MAX_BEHIND_MS = 15_000;
/** A longer gap between two reports is a lost signal, not one stretch of road. */
export const MAX_GAP_MS = 30_000;
/** Until a vehicle's gaps are known (`PING_INTERVAL_MS` of the simulator). */
const DEFAULT_GAP_MS = 5_000;
const LEAD = 1.2;
const MARGIN_MS = 500;
/** How much a new gap counts against the earlier average. */
const SMOOTHING = 0.25;
/** A device time this far from the arrival time is not believed. */
const PLAUSIBLE_MS = 60_000;
/** …unless the device keeps sending it: then its clock was set anew. */
const CLOCK_RESET_AFTER = 3;
/** The clock offset may sink by this per ms, for clocks that drift apart. */
const DRIFT_PER_MS = 0.001;
/** A new trip whose road starts further than this from the last report is somewhere else. */
const PATH_JOIN_METERS = 1_000;
const SAME_POINT_METERS = 0.5;
/** A stored fix belongs to a vertex of the trip line within this distance. */
const MATCH_METERS = 30;
const METERS_PER_DEGREE = 111_320;

export type RoadPoint = { lat: number; lng: number };

export type PlaybackReport = RoadPoint & {
    /** The device time as the API sends it; null or unreadable: arrival time instead. */
    recordedAt: string | null;
    /** Road points between the previous report and this one, in order. */
    road?: readonly RoadPoint[];
    /** The road points begin a new trip (`path_reset`). */
    newTrip?: boolean;
    /** Show this report at once (reduced motion). */
    jump?: boolean;
};

/** A stored telemetry point (`GET /api/vehicles/:id/telemetry`). */
export type PlaybackFix = RoadPoint & { recordedAt: string };

export type ShownPosition = RoadPoint & {
    /** Nothing changes until new data arrives. */
    done: boolean;
    /** Points of the current line (trip) behind the shown position. */
    passed: number;
    /** How old the shown position is on the device clock, in ms. */
    age: number | null;
    /** The time comes from the arrival or the browser clock, not from the device. */
    estimated: boolean;
};

type Sample = RoadPoint & {
    t: number;
    line: number;
    ordinal: number;
    estimated: boolean;
};

type Track = {
    samples: Sample[];
    /** samples[cursor].t <= p, and the next sample is later than p. */
    cursor: number;
    /** The device time shown. */
    p: number;
    rate: number;
    /** Local time of the last step. */
    frame: number;
    /** Device time minus local time, from the least delayed report. */
    offset: number;
    /** The offset is the browser's wall clock, not yet learnt from a report. */
    provisional: boolean;
    arrival: number | null;
    lastText: string | null;
    gapAvg: number | null;
    gapDev: number;
    late: number;
    delay: number;
    implausible: number;
    line: number;
    nextOrdinal: number;
};

const meters = (a: RoadPoint, b: RoadPoint) => {
    const dy = (b.lat - a.lat) * METERS_PER_DEGREE;
    const dx =
        (b.lng - a.lng) *
        METERS_PER_DEGREE *
        Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);

    return Math.hypot(dx, dy);
};

const finite = (point: RoadPoint) =>
    Number.isFinite(point.lat) && Number.isFinite(point.lng);

const samePlace = (a: RoadPoint, b: RoadPoint) =>
    a.lat === b.lat && a.lng === b.lng;

const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

const lastOf = <T>(items: readonly T[]) => items[items.length - 1]!;

const delayOf = (track: Pick<Track, "gapAvg" | "gapDev" | "late">) =>
    clamp(
        LEAD * (track.gapAvg ?? DEFAULT_GAP_MS) +
            2 * track.gapDev +
            2 * track.late +
            MARGIN_MS,
        MIN_DELAY_MS,
        MAX_DELAY_MS,
    );

const noteGap = (track: Track, gap: number) => {
    if (gap <= 0 || gap > MAX_GAP_MS) {
        return;
    }

    if (track.gapAvg === null) {
        track.gapAvg = gap;
    } else {
        track.gapDev =
            track.gapDev * (1 - SMOOTHING) +
            Math.abs(gap - track.gapAvg) * SMOOTHING;
        track.gapAvg = track.gapAvg * (1 - SMOOTHING) + gap * SMOOTHING;
    }

    track.delay = delayOf(track);
};

/**
 * Timed samples from `from` (already in the buffer) along `points` to time `t`:
 * each point gets its share of the time by the distance driven to it.
 */
const timeAlong = (
    from: Sample,
    points: readonly (RoadPoint & { ordinal: number; line: number })[],
    t: number,
    estimated: boolean,
): Sample[] => {
    const along: number[] = [];
    let total = 0;
    let previous: RoadPoint = from;

    for (const point of points) {
        total += meters(previous, point);
        along.push(total);
        previous = point;
    }

    const span = t - from.t;
    // Standing (no distance): the points keep the place, the time is the report's.
    const timeAt = (index: number) =>
        index === points.length - 1 || total === 0
            ? t
            : from.t + (span * along[index]!) / total;

    return points.map((point, index) => ({
        lat: point.lat,
        lng: point.lng,
        line: point.line,
        ordinal: point.ordinal,
        estimated,
        t: timeAt(index),
    }));
};

export class VehiclePlayback {
    private readonly tracks = new Map<number, Track>();
    private readonly clockOffset: () => number;

    constructor(
        options: {
            /** Epoch ms minus local ms (default: `Date.now() - performance.now()`). */
            clockOffset?: () => number;
        } = {},
    ) {
        this.clockOffset =
            options.clockOffset ?? (() => Date.now() - performance.now());
    }

    /**
     * Records a report that arrived at local time `arrivedAt`. Returns true
     * when it added something to play.
     */
    report(id: number, report: PlaybackReport, arrivedAt: number): boolean {
        const point = { lat: report.lat, lng: report.lng };

        if (!finite(point)) {
            return false;
        }

        const track = this.tracks.get(id);
        const parsed =
            report.recordedAt === null
                ? null
                : parseRecordedAt(report.recordedAt);

        if (!track) {
            const offset =
                parsed === null ? this.clockOffset() : parsed - arrivedAt;
            const t = parsed ?? arrivedAt + offset;

            this.tracks.set(id, {
                samples: [
                    { ...point, t, line: 0, ordinal: 0, estimated: parsed === null },
                ],
                cursor: 0,
                p: t,
                rate: 0,
                frame: arrivedAt,
                offset,
                provisional: parsed === null,
                arrival: parsed === null ? null : arrivedAt,
                lastText: report.recordedAt,
                gapAvg: null,
                gapDev: 0,
                late: 0,
                delay: delayOf({ gapAvg: null, gapDev: 0, late: 0 }),
                implausible: 0,
                line: 0,
                nextOrdinal: 1,
            });
            return false;
        }

        const newest = lastOf(track.samples);

        if (report.recordedAt === track.lastText && samePlace(newest, point)) {
            return false;
        }

        this.advance(track, arrivedAt);

        const estimate = arrivedAt + track.offset;
        let t: number;
        let estimated = false;
        let clockReset = false;

        if (
            parsed !== null &&
            !track.provisional &&
            Math.abs(parsed - estimate) > PLAUSIBLE_MS
        ) {
            track.implausible += 1;

            if (track.implausible >= CLOCK_RESET_AFTER) {
                track.implausible = 0;
                track.provisional = true;
                clockReset = true;
                t = parsed;
            } else {
                t = estimate;
                estimated = true;
            }
        } else if (parsed !== null) {
            track.implausible = 0;
            t = parsed;
        } else {
            t = estimate;
            estimated = true;
        }

        if (!estimated && !clockReset && t <= newest.t) {
            // Older than what is buffered: a late duplicate or out of order.
            // The road it belongs to is already behind the newest point.
            return false;
        }

        if (estimated) {
            t = Math.max(t, newest.t + 1);
        }

        track.lastText = report.recordedAt;

        if (!estimated) {
            const sample = t - arrivedAt;

            if (track.provisional) {
                track.offset = sample;
                track.provisional = false;
            } else {
                const decayed =
                    track.offset -
                    (arrivedAt - (track.arrival ?? arrivedAt)) * DRIFT_PER_MS;

                track.offset = Math.max(sample, decayed);
            }

            track.late =
                track.late * (1 - SMOOTHING) +
                (track.offset - sample) * SMOOTHING;
            track.arrival = arrivedAt;
        }

        const gap = t - newest.t;
        const road = (report.road ?? []).filter(finite);
        const joins =
            !report.newTrip ||
            road.length === 0 ||
            meters(newest, road[0]!) <= PATH_JOIN_METERS;

        if (report.newTrip) {
            track.line += 1;
            track.nextOrdinal = 0;
        }

        // Ordinals: every road point is one point of the trip line; the report
        // is the last road point (or a new one when it lies apart from it).
        const points = road.map((roadPoint) => ({
            ...roadPoint,
            line: track.line,
            ordinal: track.nextOrdinal++,
        }));
        const end = points[points.length - 1];

        if (end && meters(end, point) <= SAME_POINT_METERS) {
            end.lat = point.lat;
            end.lng = point.lng;
        } else if (!end && meters(newest, point) <= SAME_POINT_METERS) {
            points.push({
                ...point,
                line: newest.line,
                ordinal: newest.ordinal,
            });
        } else {
            points.push({ ...point, line: track.line, ordinal: track.nextOrdinal++ });
        }

        if (
            report.jump ||
            clockReset ||
            !joins ||
            gap > MAX_GAP_MS
        ) {
            // Shown at once: the stretch before it is not one drive we can play.
            const at = lastOf(points);

            track.samples = [{ ...at, t, estimated }];
            track.cursor = 0;
            track.p = t;
            track.rate = 0;
            track.frame = arrivedAt;
            return false;
        }

        noteGap(track, gap);
        track.samples.push(...timeAlong(newest, points, t, estimated));
        this.prune(
            track,
            Math.max(track.p, estimate - MAX_DELAY_MS - MAX_BEHIND_MS),
        );
        return true;
    }

    /**
     * Fills a vehicle's buffer from its stored fixes and, when known, the line
     * of its open trip, so it moves the moment a map opens instead of waiting
     * for the next report. Fixes are matched to the line's vertices from the
     * newest backwards; the vertices between two fixes get their times by
     * distance. Without a line the fixes are joined straight.
     */
    seed(
        id: number,
        fixes: readonly PlaybackFix[],
        line: readonly RoadPoint[],
        now: number,
    ) {
        const timed = fixes
            .flatMap((fix) => {
                const t = parseRecordedAt(fix.recordedAt);

                return t !== null && finite(fix)
                    ? [{ lat: fix.lat, lng: fix.lng, t }]
                    : [];
            })
            .sort((a, b) => a.t - b.t)
            .filter((fix, index, all) => all[index + 1]?.t !== fix.t);

        if (timed.length === 0) {
            return;
        }

        const previous = this.tracks.get(id);
        const lineId = (previous?.line ?? 0) + 1;
        const samples = this.alignToLine(timed, line, lineId);
        const newest = lastOf(samples);
        const learnt = previous && !previous.provisional;
        const offset = Math.max(
            learnt ? previous.offset : this.clockOffset(),
            newest.t - now,
        );
        const track: Track = {
            samples,
            cursor: 0,
            p: samples[0]!.t,
            rate: 1,
            frame: now,
            offset,
            provisional: !learnt,
            arrival: learnt ? previous.arrival : null,
            lastText: null,
            gapAvg: learnt ? previous.gapAvg : null,
            gapDev: learnt ? previous.gapDev : 0,
            late: learnt ? previous.late : 0,
            delay: 0,
            implausible: 0,
            line: lineId,
            nextOrdinal: line.length >= 2 ? line.length : timed.length,
        };

        if (!learnt) {
            for (let index = 1; index < timed.length; index += 1) {
                noteGap(track, timed[index]!.t - timed[index - 1]!.t);
            }
        }

        track.delay = delayOf(track);
        track.p = clamp(now + offset - track.delay, samples[0]!.t, newest.t);
        this.moveCursor(track);
        this.tracks.set(id, track);
    }

    private alignToLine(
        timed: readonly (RoadPoint & { t: number })[],
        line: readonly RoadPoint[],
        lineId: number,
    ): Sample[] {
        const chord = () =>
            timed.map((fix, ordinal) => ({
                ...fix,
                line: lineId,
                ordinal,
                estimated: false,
            }));
        const vertices = line.filter(finite);

        if (vertices.length < 2) {
            return chord();
        }

        const anchors: { index: number; t: number }[] = [];
        let upTo = vertices.length - 1;

        for (let fix = timed.length - 1; fix >= 0; fix -= 1) {
            const point = timed[fix]!;
            let best = -1;
            let bestMeters = MATCH_METERS;

            for (let index = upTo; index >= 0; index -= 1) {
                const distance = meters(vertices[index]!, point);

                if (distance <= bestMeters) {
                    best = index;
                    bestMeters = distance;
                } else if (best >= 0 && distance > MATCH_METERS) {
                    break;
                }
            }

            if (best < 0) {
                if (anchors.length > 0) {
                    // Older fixes belong to another trip.
                    break;
                }

                // Newer than the line: the next report brings that road.
                continue;
            }

            anchors.unshift({ index: best, t: point.t });
            upTo = best;
        }

        if (anchors.length === 0) {
            return chord();
        }

        const first = anchors[0]!;
        const samples: Sample[] = [
            {
                ...vertices[first.index]!,
                t: first.t,
                line: lineId,
                ordinal: first.index,
                estimated: false,
            },
        ];

        for (let next = 1; next < anchors.length; next += 1) {
            const from = lastOf(samples);
            const anchor = anchors[next]!;
            const points =
                anchor.index === anchors[next - 1]!.index
                    ? [{ ...vertices[anchor.index]!, line: lineId, ordinal: anchor.index }]
                    : vertices
                          .slice(anchors[next - 1]!.index + 1, anchor.index + 1)
                          .map((vertex, offset) => ({
                              ...vertex,
                              line: lineId,
                              ordinal: anchors[next - 1]!.index + 1 + offset,
                          }));

            samples.push(...timeAlong(from, points, anchor.t, false));
        }

        return samples;
    }

    /** The position to draw at local time `now`; undefined for a vehicle never reported. */
    at(id: number, now: number): ShownPosition | undefined {
        const track = this.tracks.get(id);

        if (!track) {
            return undefined;
        }

        this.advance(track, now);

        const { samples, cursor } = track;
        const from = samples[cursor]!;
        const to = samples[cursor + 1];
        const newest = lastOf(samples);
        const point = to ? this.between(from, to, track.p) : from;
        const done =
            track.p >= newest.t ||
            (samePlace(from, newest) && (!to || samePlace(to, newest)));

        return {
            lat: point.lat,
            lng: point.lng,
            done,
            passed: from.line === track.line ? from.ordinal + 1 : 0,
            age: now + track.offset - track.p,
            estimated: track.provisional || (to ?? from).estimated,
        };
    }

    /**
     * Where the vehicle will be shown `ms` from now at the current rate,
     * never beyond the newest report (for a flight or a camera pan).
     */
    ahead(id: number, now: number, ms: number): RoadPoint | undefined {
        const track = this.tracks.get(id);

        if (!track) {
            return undefined;
        }

        this.advance(track, now);

        const time = Math.min(
            lastOf(track.samples).t,
            track.p + Math.max(track.rate, 1) * ms,
        );
        let index = track.cursor;

        while (
            index < track.samples.length - 1 &&
            track.samples[index + 1]!.t <= time
        ) {
            index += 1;
        }

        const from = track.samples[index]!;
        const to = track.samples[index + 1];
        const point = to ? this.between(from, to, time) : from;

        return { lat: point.lat, lng: point.lng };
    }

    /**
     * The middle of the vehicles shown at `now` (a group's symbol rides there,
     * so it moves exactly as smoothly as its members). Undefined when none of
     * them was ever reported.
     */
    centre(
        ids: readonly number[],
        now: number,
    ): { lat: number; lng: number; done: boolean } | undefined {
        let lat = 0;
        let lng = 0;
        let count = 0;
        let done = true;

        for (const id of ids) {
            const shown = this.at(id, now);

            if (!shown) {
                continue;
            }

            lat += shown.lat;
            lng += shown.lng;
            count += 1;
            done = done && shown.done;
        }

        return count === 0
            ? undefined
            : { lat: lat / count, lng: lng / count, done };
    }

    /** The newest known point (the base of the next `path_delta`). */
    last(id: number): RoadPoint | undefined {
        const track = this.tracks.get(id);
        const newest = track ? lastOf(track.samples) : undefined;

        return newest ? { lat: newest.lat, lng: newest.lng } : undefined;
    }

    /** True when there is a stretch left to play (else history would help). */
    canPlay(id: number): boolean {
        const track = this.tracks.get(id);

        return (
            track !== undefined &&
            track.samples.length > 1 &&
            track.p < lastOf(track.samples).t
        );
    }

    /** The delay the vehicle is played back with, in ms. */
    delay(id: number): number | undefined {
        return this.tracks.get(id)?.delay;
    }

    /** Buffered samples (tests). */
    size(id: number): number | undefined {
        return this.tracks.get(id)?.samples.length;
    }

    forget(id: number) {
        this.tracks.delete(id);
    }

    /** Forgets vehicles that are no longer on the map. */
    retain(ids: ReadonlySet<number>) {
        for (const id of this.tracks.keys()) {
            if (!ids.has(id)) {
                this.tracks.delete(id);
            }
        }
    }

    private between(from: Sample, to: Sample, time: number): RoadPoint {
        const f = to.t > from.t ? clamp((time - from.t) / (to.t - from.t), 0, 1) : 1;

        return {
            lat: from.lat + (to.lat - from.lat) * f,
            lng: from.lng + (to.lng - from.lng) * f,
        };
    }

    /** Moves the shown device time to local time `now`. */
    private advance(track: Track, now: number) {
        const dt = now - track.frame;

        if (dt <= 0) {
            return;
        }

        track.frame = now;

        const newest = lastOf(track.samples).t;

        if (track.p >= newest) {
            track.p = newest;
            track.rate = 0;
            this.moveCursor(track);
            return;
        }

        const target = now + track.offset - track.delay;

        if (dt > FRAME_STALL_MS || target - track.p > MAX_BEHIND_MS) {
            track.p = Math.min(newest, Math.max(track.p, target));
            track.rate = 1;
        } else {
            const steer = clamp(
                1 + (target - track.p) / STEER_MS,
                MIN_RATE,
                MAX_RATE,
            );
            const brake = (newest - track.p) / BRAKE_MS;
            const rate = Math.max(
                0,
                Math.min(steer, brake, track.rate + ACCEL_PER_MS * dt),
            );

            track.p = Math.min(newest, track.p + rate * dt);
            track.rate = rate;

            if (newest - track.p < 1) {
                track.p = newest;
                track.rate = 0;
            }
        }

        this.moveCursor(track);

        if (track.cursor > 32) {
            this.prune(track, track.p);
        }
    }

    private moveCursor(track: Track) {
        const { samples } = track;

        while (
            track.cursor < samples.length - 1 &&
            samples[track.cursor + 1]!.t <= track.p
        ) {
            track.cursor += 1;
        }
    }

    /** Drops samples that lie wholly before `keepFrom`. */
    private prune(track: Track, keepFrom: number) {
        const { samples } = track;
        let drop = 0;

        while (drop < samples.length - 1 && samples[drop + 1]!.t <= keepFrom) {
            drop += 1;
        }

        if (drop === 0) {
            return;
        }

        samples.splice(0, drop);
        track.cursor = Math.max(0, track.cursor - drop);

        if (track.p < samples[0]!.t) {
            track.p = samples[0]!.t;
            track.cursor = 0;
        }

        this.moveCursor(track);
    }
}
