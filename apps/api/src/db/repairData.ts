import { OFFLINE_AFTER_MS } from "@fleet-live/shared";
import { db, withTransaction } from "./database";
import { sqliteFromMs } from "../lib/sqlTime";
import { AlertModel } from "../models/alert.model";
import { ExceptionEventModel } from "../models/exceptionEvent.model";
import { SiteModel } from "../models/site.model";
import { SpeedingEventModel } from "../models/speedingEvent.model";
import { TelemetryModel } from "../models/telemetry.model";
import { TripModel } from "../models/trip.model";
import { VehicleModel } from "../models/vehicle.model";

export type RepairRuleId =
    | "driving_without_driver"
    | "driving_without_trip"
    | "offline_without_warning"
    | "alerts_out_of_order"
    | "depot_presence";

export type RepairRuleReport = {
    id: RepairRuleId;
    label: string;
    /** Betroffene Zeilen; bei einem echten Lauf die, die geändert wurden. */
    count: number;
    /** Ein paar Kennzeichen oder IDs zum Nachsehen. */
    examples: string[];
};

export type RepairResult = {
    dryRun: boolean;
    rules: RepairRuleReport[];
    total: number;
};

type VehicleRow = { id: number; company_id: number; license_plate: string };

const EXAMPLES = 5;

/**
 * Räumt Zustände auf, die es nach den Regeln der App nicht geben darf und die
 * Altbestand oder Seed-Skripte hinterlassen haben:
 *
 * 1. `DRIVING` ohne aktuellen Fahrer: ein Fahrzeug fährt nie ohne Fahrer. Es
 *    wird `IDLE`, die Fahrt endet wie in `syncTrip` (Abschlusspunkt mit Tempo 0,
 *    Tempo-Ereignis zu, Fahrt geschlossen). Es wird kein Fahrer erfunden.
 * 2. `DRIVING` ohne offene Fahrt: `DRIVING` öffnet die Fahrt.
 * 3. `OFFLINE` ohne offene Funk-Warnung: `OFFLINE` öffnet sie, mit dem Zeitpunkt
 *    der letzten Meldung plus der Funkstille-Schwelle.
 * 4. Warnungen, die vor ihrer Entstehung beendet oder erledigt sind.
 * 5. Depot-Zugehörigkeit nach dem letzten Standort (`depot_site_id`).
 *
 * Läuft der Reihe nach; Regel 2 sieht, was Regel 1 übrig lässt.
 */
export function repairData(
    options: { dryRun?: boolean; companyId?: number } = {},
): RepairResult {
    const dryRun = options.dryRun ?? false;
    const scope = options.companyId === undefined ? "" : " AND v.company_id = ?";
    const scopeParams = options.companyId === undefined ? [] : [options.companyId];
    const reports: RepairRuleReport[] = [];

    const vehicles = (sql: string): VehicleRow[] =>
        db.prepare(sql).all(...scopeParams) as VehicleRow[];
    const plates = (rows: VehicleRow[]) =>
        rows.slice(0, EXAMPLES).map((row) => row.license_plate);

    withTransaction(() => {
        // 1. DRIVING ohne aktuellen Fahrer
        const noDriver = vehicles(
            `SELECT v.id, v.company_id, v.license_plate FROM vehicles v
             WHERE v.status = 'DRIVING' AND v.current_driver_id IS NULL${scope}
             ORDER BY v.company_id, v.id`,
        );

        if (!dryRun) {
            const companies = new Set<number>();

            for (const row of noDriver) {
                VehicleModel.update(row.id, { status: "IDLE" }, row.company_id);
                TelemetryModel.recordStandstill(row.id);
                SpeedingEventModel.endForVehicle(row.id);
                TripModel.close(row.id);
                ExceptionEventModel.syncVehicle({ id: row.id, status: "IDLE" });
                companies.add(row.company_id);
            }

            for (const companyId of companies) {
                TripModel.pruneClosedForCompany(companyId);
            }
        }

        reports.push({
            id: "driving_without_driver",
            label: "Auf Fahrt ohne aktuellen Fahrer (auf Standby gesetzt)",
            count: noDriver.length,
            examples: plates(noDriver),
        });

        // 2. DRIVING ohne offene Fahrt
        const noTrip = vehicles(
            `SELECT v.id, v.company_id, v.license_plate FROM vehicles v
             WHERE v.status = 'DRIVING'
               AND NOT EXISTS (
                   SELECT 1 FROM trips t
                   WHERE t.vehicle_id = v.id AND t.ended_at IS NULL
               )${scope}
             ORDER BY v.company_id, v.id`,
        ).filter(
            // Fahrzeuge aus Regel 1 werden Standby, nicht „Fahrt eröffnet“ (im Probelauf noch DRIVING).
            (row) => !noDriver.some((fixed) => fixed.id === row.id),
        );

        if (!dryRun) {
            for (const row of noTrip) {
                TripModel.open(row.id);
            }
        }

        reports.push({
            id: "driving_without_trip",
            label: "Auf Fahrt ohne offene Fahrt (Fahrt eröffnet)",
            count: noTrip.length,
            examples: plates(noTrip),
        });

        // 3. OFFLINE ohne offene Funk-Warnung
        const silent = db
            .prepare(
                `SELECT v.id, v.company_id, v.license_plate, t.recorded_at AS last_report
                 FROM vehicles v
                 LEFT JOIN telemetry t ON t.id = v.last_telemetry_id
                 WHERE v.status = 'OFFLINE'
                   AND NOT EXISTS (
                       SELECT 1 FROM alerts a
                       WHERE a.vehicle_id = v.id AND a.type = 'OFFLINE'
                         AND a.ended_at IS NULL
                   )${scope}
                 ORDER BY v.company_id, v.id`,
            )
            .all(...scopeParams) as Array<VehicleRow & { last_report: string | null }>;

        if (!dryRun) {
            for (const row of silent) {
                const reportedAt = row.last_report
                    ? Date.parse(`${row.last_report}Z`)
                    : Number.NaN;
                const opened = Number.isNaN(reportedAt)
                    ? Date.now()
                    : reportedAt + OFFLINE_AFTER_MS;

                AlertModel.ensureOpen({
                    vehicleId: row.id,
                    type: "OFFLINE",
                    createdAt: sqliteFromMs(opened),
                    severity: "HIGH",
                    message: "Fahrzeug sendet kein Signal.",
                    details: null,
                });
            }
        }

        reports.push({
            id: "offline_without_warning",
            label: "Kein Signal ohne offene Funk-Warnung (Warnung eröffnet)",
            count: silent.length,
            examples: plates(silent),
        });

        // 4. Warnungen mit falscher Zeitfolge
        const crooked = db
            .prepare(
                `SELECT a.id FROM alerts a
                 JOIN vehicles v ON v.id = a.vehicle_id
                 WHERE (a.ended_at IS NOT NULL AND a.ended_at < a.created_at)
                    OR (a.resolved_at IS NOT NULL AND a.resolved_at < a.created_at)${scope}
                 ORDER BY a.id`,
            )
            .all(...scopeParams) as Array<{ id: number }>;

        if (!dryRun && crooked.length > 0) {
            const ids = JSON.stringify(crooked.map((row) => row.id));

            // „Beendet“ nicht vor dem Beginn; „erledigt“ nicht vor dem Ende, sonst nicht vor dem Beginn.
            db.prepare(
                `UPDATE alerts SET ended_at = created_at
                 WHERE id IN (SELECT value FROM json_each(?))
                   AND ended_at IS NOT NULL AND ended_at < created_at`,
            ).run(ids);
            db.prepare(
                `UPDATE alerts SET resolved_at = MAX(resolved_at, COALESCE(ended_at, created_at))
                 WHERE id IN (SELECT value FROM json_each(?))
                   AND resolved_at IS NOT NULL AND resolved_at < created_at`,
            ).run(ids);
        }

        reports.push({
            id: "alerts_out_of_order",
            label: "Warnungen, die vor ihrem Beginn beendet oder erledigt sind (Zeit korrigiert)",
            count: crooked.length,
            examples: crooked.slice(0, EXAMPLES).map((row) => `Warnung ${row.id}`),
        });

        // 5. Depot-Zugehörigkeit nach dem letzten Standort
        const companyIds = (
            db
                .prepare(
                    `SELECT DISTINCT v.company_id AS id FROM vehicles v
                     WHERE 1 = 1${scope} ORDER BY 1`,
                )
                .all(...scopeParams) as Array<{ id: number }>
        ).map((row) => row.id);
        const changed: string[] = [];
        const siteOf = (companyId: number) =>
            new Map(
                (
                    db
                        .prepare(
                            `SELECT id, license_plate, depot_site_id FROM vehicles WHERE company_id = ?`,
                        )
                        .all(companyId) as Array<{
                        id: number;
                        license_plate: string;
                        depot_site_id: number | null;
                    }>
                ).map((row) => [row.id, row]),
            );

        for (const companyId of companyIds) {
            const before = siteOf(companyId);

            // Ein Probelauf rechnet ebenfalls, rollt aber zurück.
            if (dryRun) {
                db.exec("SAVEPOINT repair_depot");
            }

            SiteModel.refreshInside(companyId);

            const after = siteOf(companyId);

            if (dryRun) {
                db.exec("ROLLBACK TO repair_depot");
                db.exec("RELEASE repair_depot");
            }

            for (const [id, row] of before) {
                if (after.get(id)?.depot_site_id !== row.depot_site_id) {
                    changed.push(row.license_plate);
                }
            }
        }

        reports.push({
            id: "depot_presence",
            label: "Depot-Zugehörigkeit passte nicht zum Standort (neu berechnet)",
            count: changed.length,
            examples: changed.slice(0, EXAMPLES),
        });
    });

    return {
        dryRun,
        rules: reports,
        total: reports.reduce((sum, rule) => sum + rule.count, 0),
    };
}
