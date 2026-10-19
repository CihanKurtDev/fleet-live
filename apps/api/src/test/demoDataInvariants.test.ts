import "./env";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { db } from "../db/database";
import { seedLivedIn } from "../db/seedLivedIn";
import { VehicleModel } from "../models/vehicle.model";

/**
 * Das Demo-Skript darf nur Zustände erzeugen, die die Regeln der App erlauben.
 * Jede Zeile zählt Verstöße; es muss 0 sein.
 */
const INVARIANTS: Array<[string, string]> = [
    [
        "ein Fahrzeug fährt nie ohne Fahrer",
        `SELECT COUNT(*) AS c FROM vehicles WHERE status = 'DRIVING' AND current_driver_id IS NULL`,
    ],
    [
        "eine offene Fahrt gibt es nur bei einem Fahrzeug auf Fahrt",
        `SELECT COUNT(*) AS c FROM trips t JOIN vehicles v ON v.id = t.vehicle_id
         WHERE t.ended_at IS NULL AND v.status <> 'DRIVING'`,
    ],
    [
        "ein Fahrzeug ohne Signal hat eine offene Funk-Warnung",
        `SELECT COUNT(*) AS c FROM vehicles v WHERE v.status = 'OFFLINE'
           AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.vehicle_id = v.id
                           AND a.type = 'OFFLINE' AND a.ended_at IS NULL)`,
    ],
    [
        "eine offene Funk-Warnung gehört zu einem Fahrzeug ohne Signal",
        `SELECT COUNT(*) AS c FROM alerts a JOIN vehicles v ON v.id = a.vehicle_id
         WHERE a.type = 'OFFLINE' AND a.ended_at IS NULL AND v.status <> 'OFFLINE'`,
    ],
    [
        "ein Fahrzeug unter der Tank-Schwelle hat genau eine offene Tank-Warnung",
        `SELECT COUNT(*) AS c FROM vehicles v WHERE v.fuel_level < 15
           AND (SELECT COUNT(*) FROM alerts a WHERE a.vehicle_id = v.id
                AND a.type = 'LOW_FUEL' AND a.resolved_at IS NULL) <> 1`,
    ],
    [
        "eine offene Tank-Warnung gehört zu einem Fahrzeug unter der Schwelle",
        `SELECT COUNT(*) AS c FROM alerts a JOIN vehicles v ON v.id = a.vehicle_id
         WHERE a.type = 'LOW_FUEL' AND a.resolved_at IS NULL AND v.fuel_level >= 15`,
    ],
    [
        "ein offenes Tempo-Ereignis gibt es nur bei einem Fahrzeug auf Fahrt",
        `SELECT COUNT(*) AS c FROM alerts a JOIN vehicles v ON v.id = a.vehicle_id
         WHERE a.type = 'SPEEDING' AND a.ended_at IS NULL AND v.status <> 'DRIVING'`,
    ],
    [
        "eine Warnung wird nicht vor ihrem Beginn beendet oder erledigt",
        `SELECT COUNT(*) AS c FROM alerts
         WHERE (ended_at IS NOT NULL AND ended_at < created_at)
            OR (resolved_at IS NOT NULL AND resolved_at < created_at)`,
    ],
    [
        "der aktuelle Fahrer ist für das Fahrzeug freigegeben",
        `SELECT COUNT(*) AS c FROM vehicles v WHERE v.current_driver_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM driver_vehicles dv
                           WHERE dv.vehicle_id = v.id AND dv.driver_id = v.current_driver_id)`,
    ],
    [
        "Fahrer und Fahrzeug gehören zur selben Firma",
        `SELECT COUNT(*) AS c FROM vehicles v JOIN drivers d ON d.id = v.current_driver_id
         WHERE d.company_id <> v.company_id`,
    ],
    [
        "der Fahrername am Fahrzeug passt zum aktuellen Fahrer",
        `SELECT COUNT(*) AS c FROM vehicles v LEFT JOIN drivers d ON d.id = v.current_driver_id
         WHERE (v.current_driver_id IS NULL AND v.driver_name IS NOT NULL)
            OR (v.current_driver_id IS NOT NULL AND v.driver_name IS NOT d.name)`,
    ],
    [
        "nur ein fahrendes Fahrzeug hat ein Tempo über 0 im letzten Punkt",
        `SELECT COUNT(*) AS c FROM vehicles v JOIN telemetry t ON t.id = v.last_telemetry_id
         WHERE v.status <> 'DRIVING' AND t.speed > 0`,
    ],
    [
        "active_alerts zählt die unerledigten Warnungen",
        `SELECT COUNT(*) AS c FROM vehicles v WHERE v.active_alerts <>
           (SELECT COUNT(*) FROM alerts a WHERE a.vehicle_id = v.id AND a.resolved_at IS NULL)`,
    ],
];

describe("the demo data follows the rules of the app", () => {
    before(() => {
        seedLivedIn(db);
    });

    after(() => {
        VehicleModel.resetForTests();
    });

    for (const [rule, sql] of INVARIANTS) {
        it(rule, () => {
            const row = db.prepare(sql).get() as { c: number };

            assert.equal(row.c, 0);
        });
    }

    it("has a fleet to check", () => {
        const row = db.prepare(`SELECT COUNT(*) AS c FROM vehicles`).get() as {
            c: number;
        };

        assert.ok(row.c > 100, `vehicles: ${row.c}`);
    });
});
