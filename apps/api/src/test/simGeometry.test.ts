import "./env";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    NEAR_ROUTE_METERS,
    SIM_ROUTES,
    pickRoute,
    haversineMeters,
    nearestFraction,
    pointAtFraction,
    routeLengthMeters,
    verticesBetween,
    type LatLng,
} from "../sim/routes";

/** Der frühere Ablauf über alle Stützpunkte: die Referenz für die Suche mit Summen. */
function referencePointAtFraction(points: LatLng[], frac: number): LatLng {
    const end = points[points.length - 1]!;
    const target = routeLengthMeters(points) * Math.min(1, Math.max(0, frac));
    let walked = 0;

    for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1]!;
        const to = points[index]!;
        const segment = haversineMeters(from, to);

        if (walked + segment >= target) {
            const t = segment === 0 ? 0 : (target - walked) / segment;
            return {
                lat: from.lat + (to.lat - from.lat) * t,
                lng: from.lng + (to.lng - from.lng) * t,
            };
        }

        walked += segment;
    }

    return end;
}

function referenceVerticesBetween(
    points: LatLng[],
    fromFrac: number,
    toFrac: number,
): LatLng[] {
    if (points.length < 2 || fromFrac === toFrac) {
        return [referencePointAtFraction(points, toFrac)];
    }

    const forward = toFrac >= fromFrac;
    const low = forward ? fromFrac : toFrac;
    const high = forward ? toFrac : fromFrac;
    const total = routeLengthMeters(points);
    const startM = total * Math.min(1, Math.max(0, low));
    const endM = total * Math.min(1, Math.max(0, high));
    const collected: LatLng[] = [];
    let walked = 0;

    for (let index = 1; index < points.length; index += 1) {
        const nextWalked =
            walked + haversineMeters(points[index - 1]!, points[index]!);

        if (nextWalked > startM + 0.5 && nextWalked < endM - 0.5) {
            collected.push(points[index]!);
        }

        walked = nextWalked;
    }

    const end = referencePointAtFraction(points, high);
    const last = collected[collected.length - 1];

    if (!last || haversineMeters(last, end) > 0.5) {
        collected.push(end);
    }

    if (collected.length === 0) {
        collected.push(end);
    }

    return forward ? collected : collected.reverse();
}

function referenceNearestFraction(points: LatLng[], pos: LatLng): number {
    const total = routeLengthMeters(points);

    if (total === 0) {
        return 0;
    }

    let bestDist = Number.POSITIVE_INFINITY;
    let bestAlong = 0;
    let walked = 0;

    for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1]!;
        const to = points[index]!;
        const abx = to.lng - from.lng;
        const aby = to.lat - from.lat;
        const apx = pos.lng - from.lng;
        const apy = pos.lat - from.lat;
        const ab2 = abx * abx + aby * aby;
        const t =
            ab2 === 0
                ? 0
                : Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
        const dist = haversineMeters(pos, {
            lat: from.lat + aby * t,
            lng: from.lng + abx * t,
        });

        if (dist < bestDist) {
            bestDist = dist;
            bestAlong = walked + routeLengthMeters([from, to]) * t;
        }

        walked += haversineMeters(from, to);
    }

    return Math.min(1, Math.max(0, bestAlong / total));
}

function lcg(seed: number) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

describe("simulator geometry", () => {
    it("finds the same point as walking the whole route", () => {
        const random = lcg(7);

        for (const route of SIM_ROUTES) {
            const fractions = [0, 1, -0.2, 1.3, 0.5];

            for (let index = 0; index < 400; index += 1) {
                fractions.push(random());
            }

            for (const frac of fractions) {
                assert.deepEqual(
                    pointAtFraction(route.points, frac),
                    referencePointAtFraction(route.points, frac),
                    `${route.id} @ ${frac}`,
                );
            }
        }
    });

    it("finds the same nearest fraction as checking every segment", () => {
        const random = lcg(23);

        for (const route of SIM_ROUTES) {
            const first = route.points[0]!;

            for (let index = 0; index < 150; index += 1) {
                // Mal an der Strecke, mal quer über Deutschland.
                const near = index % 2 === 0;
                const base = near
                    ? route.points[Math.floor(random() * route.points.length)]!
                    : { lat: first.lat, lng: first.lng };
                // Jeder fünfte Punkt liegt genau auf einem Stützpunkt: dort
                // treffen zwei Segmente denselben Abstand (Gleichstand).
                const pos = index % 10 === 0
                    ? { lat: base.lat, lng: base.lng }
                    : near
                    ? {
                          lat: base.lat + (random() - 0.5) * 0.02,
                          lng: base.lng + (random() - 0.5) * 0.02,
                      }
                    : {
                          lat: 47.3 + random() * 8,
                          lng: 5.9 + random() * 9,
                      };

                assert.equal(
                    nearestFraction(route.points, pos),
                    referenceNearestFraction(route.points, pos),
                    `${route.id} @ ${pos.lat},${pos.lng}`,
                );
            }
        }
    });

    it("picks the same route as measuring every route", () => {
        const random = lcg(31);
        // Die Vollrechnung ist langsam: einmal pro Punkt, dann je Fahrzeug-ID wählen.
        const referencePool = (pos: LatLng) => {
            const ranked = SIM_ROUTES.map((route) => ({
                route,
                dist: haversineMeters(
                    pos,
                    referencePointAtFraction(
                        route.points,
                        referenceNearestFraction(route.points, pos),
                    ),
                ),
            })).sort((left, right) => left.dist - right.dist);
            const nearby = ranked.filter((entry) => entry.dist <= NEAR_ROUTE_METERS);

            return (nearby.length > 0 ? nearby : ranked.slice(0, 1)).map(
                (entry) => entry.route,
            );
        };
        const everyVertex = SIM_ROUTES.flatMap((route) => route.points);

        for (let index = 0; index < 120; index += 1) {
            const onRoute = everyVertex[Math.floor(random() * everyVertex.length)]!;
            const pos =
                index % 3 === 0
                    ? { lat: 47.3 + random() * 8, lng: 5.9 + random() * 9 }
                    : {
                          lat: onRoute.lat + (random() - 0.5) * 1.2,
                          lng: onRoute.lng + (random() - 0.5) * 1.2,
                      };

            const pool = referencePool(pos);

            for (const vehicleId of [1, 2, 3, 8, 13]) {
                assert.equal(
                    pickRoute(vehicleId, pos).id,
                    pool[vehicleId % pool.length]!.id,
                    `${vehicleId} @ ${pos.lat},${pos.lng}`,
                );
            }
        }
    });

    it("returns the same road vertices as walking the whole route", () => {
        const random = lcg(11);

        for (const route of SIM_ROUTES) {
            const pairs: Array<[number, number]> = [
                [0, 1],
                [1, 0],
                [0.3, 0.3],
                [0, 0],
            ];

            for (let index = 0; index < 400; index += 1) {
                const from = random();
                // Ein Tick ist kurz, Sprünge über die ganze Strecke sind die Ausnahme.
                const step = (random() - 0.5) * (index % 10 === 0 ? 1 : 0.01);
                pairs.push([from, Math.min(1, Math.max(0, from + step))]);
            }

            for (const [from, to] of pairs) {
                assert.deepEqual(
                    verticesBetween(route.points, from, to),
                    referenceVerticesBetween(route.points, from, to),
                    `${route.id} ${from} → ${to}`,
                );
            }
        }
    });
});
