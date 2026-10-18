/**
 * Where a vehicle is shown right now.
 *
 * A vehicle reports every few seconds (an irregular gap, like any tracker).
 * The map never jumps to a report: it plays the stretch from where the vehicle
 * is shown to the new report, over the time reports usually take, so it is one
 * report behind and always on its way somewhere. The stretch runs along the
 * road points that came with the report (`path_delta`), not in a straight line,
 * so a dot stays on the road through bends at every zoom. Dots, group symbols
 * and the following camera all read this one position, so they move together.
 */

/** A gap longer than this is a missed report or two, not motion: show it at once. */
export const MAX_REPORT_GAP_MS = 20_000;
/** How much a new gap counts against the earlier average. */
const GAP_SMOOTHING = 0.5;
/**
 * A stretch takes a little longer than the usual gap. A late report would leave
 * the vehicle standing; an early one only starts the next stretch from where it is.
 */
const LEAD = 1.25;
const MIN_DURATION_MS = 250;
/** A new trip whose road starts further than this from the last report is somewhere else. */
const PATH_JOIN_METERS = 1_000;
const METERS_PER_DEGREE = 111_320;

export type RoadPoint = { lat: number; lng: number };

type Tween = {
    /** The stretch being played: where it started, the road points, the report. */
    points: RoadPoint[];
    /** Distance from the first point to each point, in metres. */
    along: number[];
    start: number;
    duration: number;
    reportedAt: number;
    /** Smoothed time between this vehicle's reports. */
    gapMs: number | null;
};

export type TweenPosition = { lat: number; lng: number; done: boolean };

const meters = (a: RoadPoint, b: RoadPoint) => {
    const dy = (b.lat - a.lat) * METERS_PER_DEGREE;
    const dx =
        (b.lng - a.lng) *
        METERS_PER_DEGREE *
        Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);

    return Math.hypot(dx, dy);
};

const cumulative = (points: RoadPoint[]) => {
    const along = [0];

    for (let index = 1; index < points.length; index += 1) {
        along.push(
            along[index - 1]! + meters(points[index - 1]!, points[index]!),
        );
    }

    return along;
};

const still = (point: RoadPoint, now: number): Tween => ({
    points: [point],
    along: [0],
    start: now,
    duration: 0,
    reportedAt: now,
    gapMs: null,
});

/** Where the stretch stands at `now`: the point and the index of its segment. */
const sample = (item: Tween, now: number) => {
    const last = item.points.length - 1;
    const t =
        item.duration <= 0
            ? 1
            : Math.min(1, Math.max(0, (now - item.start) / item.duration));
    const total = item.along[last]!;

    if (t >= 1 || total === 0) {
        return { point: item.points[last]!, segment: last, done: t >= 1 };
    }

    const goal = t * total;
    let segment = 0;

    while (segment < last - 1 && item.along[segment + 1]! < goal) {
        segment += 1;
    }

    const from = item.points[segment]!;
    const to = item.points[segment + 1]!;
    const length = item.along[segment + 1]! - item.along[segment]!;
    const f = length === 0 ? 1 : (goal - item.along[segment]!) / length;

    return {
        point: {
            lat: from.lat + (to.lat - from.lat) * f,
            lng: from.lng + (to.lng - from.lng) * f,
        },
        segment,
        done: false,
    };
};

export class PositionTweens {
    private readonly items = new Map<number, Tween>();

    /**
     * Records a report, with the road points since the last one when they came
     * along. Returns true when the shown position starts to move.
     */
    report(
        id: number,
        lat: number,
        lng: number,
        now: number,
        jump = false,
        road: readonly RoadPoint[] = [],
        /** The road points begin a new trip (`path_reset`). */
        newTrip = false,
    ): boolean {
        const item = this.items.get(id);
        const target = { lat, lng };

        if (!item) {
            this.items.set(id, still(target, now));
            return false;
        }

        const previous = item.points[item.points.length - 1]!;

        if (previous.lat === lat && previous.lng === lng) {
            return false;
        }

        const gap = now - item.reportedAt;
        const joins =
            !newTrip ||
            road.length === 0 ||
            meters(previous, road[0]!) <= PATH_JOIN_METERS;

        if (jump || gap > MAX_REPORT_GAP_MS || !joins) {
            this.items.set(id, still(target, now));
            return false;
        }

        // From where the vehicle is shown, over what is left of the last
        // stretch, then along the new road points to the report.
        const { point: here, segment } = sample(item, now);
        const points = [here, ...item.points.slice(segment + 1)];

        for (const point of road) {
            if (meters(points[points.length - 1]!, point) > 0.5) {
                points.push(point);
            }
        }

        if (meters(points[points.length - 1]!, target) > 0.5) {
            points.push(target);
        } else {
            points[points.length - 1] = target;
        }

        const gapMs =
            item.gapMs === null
                ? gap
                : item.gapMs * (1 - GAP_SMOOTHING) + gap * GAP_SMOOTHING;

        this.items.set(id, {
            points,
            along: cumulative(points),
            start: now,
            duration: Math.max(MIN_DURATION_MS, gapMs * LEAD),
            reportedAt: now,
            gapMs,
        });
        return true;
    }

    /** The position to draw at `now`, or undefined for a vehicle never reported. */
    at(id: number, now: number): TweenPosition | undefined {
        const item = this.items.get(id);

        if (!item) {
            return undefined;
        }

        const { point, done } = sample(item, now);

        return { lat: point.lat, lng: point.lng, done };
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

    /** Where the vehicle is heading and how long the stretch takes (0: it is there). */
    heading(id: number): { lat: number; lng: number; ms: number } | undefined {
        const item = this.items.get(id);
        const end = item?.points[item.points.length - 1];

        return item && end
            ? { lat: end.lat, lng: end.lng, ms: item.duration }
            : undefined;
    }

    /** Forgets vehicles that are no longer on the map. */
    retain(ids: ReadonlySet<number>) {
        for (const id of this.items.keys()) {
            if (!ids.has(id)) {
                this.items.delete(id);
            }
        }
    }
}
