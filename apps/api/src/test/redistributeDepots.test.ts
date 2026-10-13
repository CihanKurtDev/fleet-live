import "./env";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { db } from "../db/database";
import {
    drivingPointForDepot,
    plannedRedistributeDepots,
    redistributeDepots,
    RedistributeNotAllowedError,
    yardPointForDepot,
} from "../db/redistributeDepots";
import { haversineMeters } from "../lib/geo";
import { SiteModel } from "../models/site.model";
import { TripModel } from "../models/trip.model";
import { VehicleModel } from "../models/vehicle.model";
import {
    NEAR_ROUTE_METERS,
    nearestFraction,
    pickRoute,
    pointAtFraction,
    SIM_ROUTES,
} from "../sim/routes";

afterEach(() => {
    VehicleModel.resetForTests();
});

describe("driving placement", () => {
    it("keeps a driving start on the route the first tick would pick", () => {
        const corridor = new Set(["Köln", "Düsseldorf", "Dortmund", "Köln bestehend"]);

        for (const depot of [
            ...plannedRedistributeDepots(),
            { name: "Köln bestehend", latitude: 50.89, longitude: 6.905 },
        ]) {
            for (const vehicleId of [1, 2, 8]) {
                const placed = drivingPointForDepot(vehicleId, depot);
                const pos = { lat: placed.latitude, lng: placed.longitude };
                const route = pickRoute(vehicleId, pos);
                const snapped = pointAtFraction(
                    route.points,
                    nearestFraction(route.points, pos),
                );
                const jump = haversineMeters(pos, snapped);

                assert.ok(placed.speed > 0);
                assert.ok(
                    haversineMeters(pos, {
                        lat: depot.latitude,
                        lng: depot.longitude,
                    }) > 800,
                    `${depot.name} liegt im Hof`,
                );

                if (corridor.has(depot.name)) {
                    const onNearest = SIM_ROUTES.map((entry) =>
                        haversineMeters(
                            pos,
                            pointAtFraction(
                                entry.points,
                                nearestFraction(entry.points, pos),
                            ),
                        ),
                    ).reduce((best, dist) => Math.min(best, dist));
                    assert.ok(onNearest < 25, `${depot.name} liegt auf keiner Strecke`);
                    assert.ok(
                        jump <= NEAR_ROUTE_METERS,
                        `${depot.name} Fahrzeug ${vehicleId} springt aus dem Korridor`,
                    );
                    continue;
                }

                assert.equal(placed.stable, true, `${depot.name} Fahrzeug ${vehicleId}`);
                assert.ok(
                    jump < 25,
                    `${depot.name} liegt nicht auf der gewählten Strecke`,
                );
            }
        }
    });

    it("parks other statuses in a deterministic ring", () => {
        const depot = { latitude: 50.89, longitude: 6.905 };
        const first = yardPointForDepot(4, depot);
        const second = yardPointForDepot(4, depot);
        const distance = haversineMeters(
            { lat: first.latitude, lng: first.longitude },
            { lat: depot.latitude, lng: depot.longitude },
        );

        assert.deepEqual(first, second);
        assert.ok(distance >= 50 && distance < 300);
    });
});

describe("redistributeDepots", () => {
    function snapshot() {
        return {
            sites: db
                .prepare(
                    `
                    SELECT id, company_id, name, latitude, longitude,
                           radius_m, is_default
                    FROM sites
                    ORDER BY id
                    `,
                )
                .all(),
            telemetry: db
                .prepare(
                    `
                    SELECT id, vehicle_id, latitude, longitude, speed
                    FROM telemetry
                    ORDER BY id
                    `,
                )
                .all(),
            trips: db
                .prepare(
                    `
                    SELECT id, vehicle_id, ended_at IS NULL AS open
                    FROM trips
                    ORDER BY id
                    `,
                )
                .all(),
            homes: db
                .prepare(
                    `
                    SELECT id, company_id, home_site_id, depot
                    FROM vehicles
                    ORDER BY id
                    `,
                )
                .all(),
        };
    }

    it("refuses to run outside development without --force", () => {
        const vehicle = VehicleModel.create({
            license_plate: "K-NO 1",
            status: "IDLE",
        });
        db.prepare(
            `
            INSERT INTO telemetry (vehicle_id, latitude, longitude, speed)
            VALUES (?, 50.9, 6.9, 0)
            `,
        ).run(vehicle.id);
        const before = snapshot();

        assert.throws(
            () => redistributeDepots({ dryRun: true, companyId: 1 }),
            RedistributeNotAllowedError,
        );
        assert.deepEqual(snapshot(), before);
    });

    it("dry-run changes nothing, then a second run is a no-op", () => {
        const koeln = SiteModel.create(1, {
            name: "Köln",
            latitude: 50.89,
            longitude: 6.905,
            radius_m: 800,
        });
        assert.equal(koeln.is_default, true);
        const otherDepot = SiteModel.create(2, {
            name: "Hof Süd",
            latitude: 48.2,
            longitude: 11.4,
        });
        const other = VehicleModel.create({
            license_plate: "M-OTH 1",
            company_id: 2,
            status: "IDLE",
            home_site_id: otherDepot.id,
        });
        db.prepare(
            `
            INSERT INTO telemetry (vehicle_id, latitude, longitude, speed)
            VALUES (?, 48.2, 11.4, 0)
            `,
        ).run(other.id);

        const driving = VehicleModel.create({
            license_plate: "K-D 1",
            status: "DRIVING",
            home_site_id: koeln.id,
        });
        const idle = VehicleModel.create({
            license_plate: "K-I 1",
            status: "IDLE",
            home_site_id: koeln.id,
        });
        const stopped = VehicleModel.create({
            license_plate: "K-S 1",
            status: "STOPPED",
            home_site_id: koeln.id,
        });
        const offline = VehicleModel.create({
            license_plate: "K-O 1",
            status: "OFFLINE",
            home_site_id: koeln.id,
        });
        const insertPoint = db.prepare(
            `
            INSERT INTO telemetry (vehicle_id, latitude, longitude, speed)
            VALUES (?, 50.89, 6.905, 0)
            `,
        );
        insertPoint.run(driving.id);
        insertPoint.run(idle.id);
        insertPoint.run(stopped.id);
        TripModel.open(driving.id);

        const before = snapshot();
        const dry = redistributeDepots({
            dryRun: true,
            force: true,
            companyId: 1,
        });

        assert.equal(dry.dryRun, true);
        assert.deepEqual(snapshot(), before);
        assert.equal(dry.companies.length, 1);
        assert.equal(dry.companies[0]?.updated, 4);
        const counted = dry.companies[0]?.depots.reduce(
            (sum, depot) =>
                sum +
                depot.counts.DRIVING +
                depot.counts.IDLE +
                depot.counts.STOPPED +
                depot.counts.OFFLINE,
            0,
        );
        assert.equal(counted, 4);
        assert.equal(
            dry.companies[0]?.depots.reduce(
                (sum, depot) => sum + depot.counts.DRIVING,
                0,
            ),
            1,
        );
        assert.equal(
            dry.companies[0]?.depots.some((depot) => depot.wouldCreate),
            true,
        );
        assert.equal(
            dry.companies[0]?.depots.every((depot) =>
                (["DRIVING", "IDLE", "STOPPED", "OFFLINE"] as const).every(
                    (status) => Number.isInteger(depot.counts[status]),
                ),
            ),
            true,
        );

        const first = redistributeDepots({ force: true, companyId: 1 });
        assert.equal(first.companies[0]?.updated, 4);

        const koelnAfter = db
            .prepare(
                `
                SELECT latitude, longitude, radius_m, is_default
                FROM sites
                WHERE id = ?
                `,
            )
            .get(koeln.id) as {
            latitude: number;
            longitude: number;
            radius_m: number;
            is_default: number;
        };
        assert.equal(koelnAfter.latitude, 50.89);
        assert.equal(koelnAfter.longitude, 6.905);
        assert.equal(koelnAfter.radius_m, 800);
        assert.equal(koelnAfter.is_default, 1);
        assert.equal(
            Number(
                (
                    db
                        .prepare(
                            `
                            SELECT COUNT(*) AS n
                            FROM sites
                            WHERE company_id = 1 AND is_default = 1
                            `,
                        )
                        .get() as { n: number }
                ).n,
            ),
            1,
        );
        assert.equal(
            Number(
                (
                    db
                        .prepare(
                            `
                            SELECT COUNT(*) AS n
                            FROM sites
                            WHERE company_id = 1 AND name != 'Köln' AND is_default = 1
                            `,
                        )
                        .get() as { n: number }
                ).n,
            ),
            0,
        );

        const placed = db
            .prepare(
                `
                SELECT v.id, v.status, t.latitude, t.longitude, t.speed,
                       s.latitude AS site_lat, s.longitude AS site_lng
                FROM vehicles v
                INNER JOIN telemetry t ON t.id = v.last_telemetry_id
                INNER JOIN sites s ON s.id = v.home_site_id
                WHERE v.company_id = 1
                `,
            )
            .all() as Array<{
            id: number;
            status: string;
            latitude: number;
            longitude: number;
            speed: number;
            site_lat: number;
            site_lng: number;
        }>;
        assert.equal(placed.length, 4);

        for (const row of placed) {
            const distance = haversineMeters(
                { lat: row.latitude, lng: row.longitude },
                { lat: row.site_lat, lng: row.site_lng },
            );

            if (row.status === "DRIVING") {
                const pos = { lat: row.latitude, lng: row.longitude };
                const route = pickRoute(row.id, pos);
                const snapped = pointAtFraction(
                    route.points,
                    nearestFraction(route.points, pos),
                );
                assert.ok(haversineMeters(pos, snapped) < 25);
                assert.ok(distance > 800);
                assert.ok(row.speed > 0);
                assert.equal(row.id, driving.id);
            } else {
                assert.ok(distance >= 50 && distance < 300);
                assert.equal(row.speed, 0);
            }
        }

        assert.equal(
            Number(
                (
                    db
                        .prepare(
                            `
                            SELECT COUNT(*) AS n
                            FROM telemetry
                            WHERE vehicle_id = ?
                            `,
                        )
                        .get(driving.id) as { n: number }
                ).n,
            ),
            1,
        );
        assert.equal(
            Number(
                (
                    db
                        .prepare(
                            `
                            SELECT COUNT(*) AS n
                            FROM telemetry
                            WHERE vehicle_id = ?
                            `,
                        )
                        .get(offline.id) as { n: number }
                ).n,
            ),
            1,
        );
        assert.equal(
            Number(
                (
                    db
                        .prepare(
                            `
                            SELECT COUNT(*) AS n
                            FROM trips
                            WHERE vehicle_id = ? AND ended_at IS NULL
                            `,
                        )
                        .get(driving.id) as { n: number }
                ).n,
            ),
            1,
        );
        assert.equal(
            Number(
                (
                    db
                        .prepare(
                            `
                            SELECT COUNT(*) AS n
                            FROM trips
                            WHERE vehicle_id = ?
                            `,
                        )
                        .get(driving.id) as { n: number }
                ).n,
            ),
            2,
        );

        const otherAfter = db
            .prepare(
                `
                SELECT t.latitude, t.longitude, v.home_site_id, s.latitude AS site_lat
                FROM vehicles v
                INNER JOIN telemetry t ON t.id = v.last_telemetry_id
                INNER JOIN sites s ON s.id = v.home_site_id
                WHERE v.id = ?
                `,
            )
            .get(other.id) as {
            latitude: number;
            longitude: number;
            home_site_id: number;
            site_lat: number;
        };
        assert.equal(otherAfter.latitude, 48.2);
        assert.equal(otherAfter.longitude, 11.4);
        assert.equal(otherAfter.home_site_id, otherDepot.id);
        assert.equal(otherAfter.site_lat, 48.2);
        assert.equal(
            Number(
                (
                    db
                        .prepare(
                            `SELECT COUNT(*) AS n FROM sites WHERE company_id = 2`,
                        )
                        .get() as { n: number }
                ).n,
            ),
            1,
        );

        const settled = snapshot();
        const second = redistributeDepots({ force: true, companyId: 1 });
        assert.equal(second.companies[0]?.updated, 0);
        assert.equal(
            second.companies[0]?.depots.some((depot) => depot.wouldCreate),
            false,
        );
        assert.deepEqual(snapshot(), settled);
        assert.equal(idle.id > 0 && stopped.id > 0, true);
    });
});
