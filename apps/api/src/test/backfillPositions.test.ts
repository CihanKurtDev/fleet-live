import "./env";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { db } from "../db/database";
import { backfillMissingPositions } from "../db/backfillPositions";
import { haversineMeters } from "../lib/geo";
import { SiteModel } from "../models/site.model";
import { VehicleModel } from "../models/vehicle.model";

afterEach(() => {
    VehicleModel.resetForTests();
});

describe("backfillMissingPositions", () => {
    it("reports depot counts and does not insert twice", () => {
        const standard = SiteModel.create(1, {
            name: "Standard",
            latitude: 50.9,
            longitude: 6.9,
        });
        const other = SiteModel.create(1, {
            name: "Andere",
            latitude: 48.1,
            longitude: 11.5,
        });
        assert.equal(standard.is_default, true);
        assert.equal(other.is_default, false);

        const atHome = VehicleModel.create({
            license_plate: "B-H 1",
            company_id: 1,
            status: "IDLE",
            home_site_id: other.id,
        });
        const pooled = VehicleModel.create({
            license_plate: "B-P 1",
            company_id: 1,
            status: "DRIVING",
        });
        const already = VehicleModel.create({
            license_plate: "B-X 1",
            company_id: 1,
        });
        db.prepare(
            `
            INSERT INTO telemetry (vehicle_id, latitude, longitude, speed)
            VALUES (?, 50, 8, 0)
            `,
        ).run(already.id);

        const dry = backfillMissingPositions({ dryRun: true, companyId: 1 });
        assert.equal(dry.inserted, 0);
        assert.equal(dry.companies.length, 1);
        assert.equal(dry.companies[0]?.total, 2);
        const counts = new Map(
            dry.companies[0]?.byDepot.map((entry) => [entry.label, entry.count]),
        );
        assert.equal(counts.get("Andere"), 1);
        assert.equal(counts.get("Standard"), 1);
        assert.equal(
            Number(
                (
                    db.prepare(`SELECT COUNT(*) AS n FROM telemetry`).get() as {
                        n: number;
                    }
                ).n,
            ),
            1,
        );

        const first = backfillMissingPositions({ companyId: 1 });
        assert.equal(first.inserted, 2);
        const second = backfillMissingPositions({ companyId: 1 });
        assert.equal(second.inserted, 0);
        assert.equal(second.companies.length, 0);
        assert.equal(
            Number(
                (
                    db
                        .prepare(
                            `SELECT COUNT(*) AS n FROM telemetry WHERE vehicle_id = ?`,
                        )
                        .get(atHome.id) as { n: number }
                ).n,
            ),
            1,
        );
        assert.equal(
            Number(
                (
                    db
                        .prepare(
                            `SELECT COUNT(*) AS n FROM telemetry WHERE vehicle_id = ?`,
                        )
                        .get(pooled.id) as { n: number }
                ).n,
            ),
            1,
        );
        assert.equal(
            Number(
                (
                    db
                        .prepare(
                            `SELECT COUNT(*) AS n FROM telemetry WHERE vehicle_id = ?`,
                        )
                        .get(already.id) as { n: number }
                ).n,
            ),
            1,
        );

        const homePoint = db
            .prepare(
                `
                SELECT t.latitude, t.longitude
                FROM telemetry t
                INNER JOIN vehicles v ON v.last_telemetry_id = t.id
                WHERE v.id = ?
                `,
            )
            .get(atHome.id) as { latitude: number; longitude: number };
        const pooledPoint = db
            .prepare(
                `
                SELECT t.latitude, t.longitude, t.speed
                FROM telemetry t
                INNER JOIN vehicles v ON v.last_telemetry_id = t.id
                WHERE v.id = ?
                `,
            )
            .get(pooled.id) as {
            latitude: number;
            longitude: number;
            speed: number;
        };
        const homeDistance = haversineMeters(
            { lat: homePoint.latitude, lng: homePoint.longitude },
            { lat: other.latitude, lng: other.longitude },
        );
        const pooledDistance = haversineMeters(
            { lat: pooledPoint.latitude, lng: pooledPoint.longitude },
            { lat: standard.latitude, lng: standard.longitude },
        );
        assert.ok(homeDistance >= 49 && homeDistance < 301);
        assert.ok(pooledDistance >= 49 && pooledDistance < 301);
        assert.ok(pooledPoint.speed > 0);
    });
});
