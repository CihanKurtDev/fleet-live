import type { VehicleStatus } from "@fleet-live/shared";
import { db, withTransaction } from "./database";
import { TelemetryModel } from "../models/telemetry.model";
import {
    resolveStartPosition,
    speedForStatus,
    type DepotAnchor,
} from "../lib/startPosition";

const BATCH_SIZE = 200;

type MissingVehicle = {
    id: number;
    company_id: number;
    status: VehicleStatus;
    home_site_id: number | null;
};

type CompanyDepots = {
    byId: Map<number, DepotAnchor>;
    defaultDepot: DepotAnchor | null;
};

export type BackfillDepotCount = {
    label: string;
    count: number;
};

export type BackfillCompanyReport = {
    companyId: number;
    total: number;
    byDepot: BackfillDepotCount[];
};

export type BackfillResult = {
    dryRun: boolean;
    inserted: number;
    companies: BackfillCompanyReport[];
};

function loadDepots(companyId: number): CompanyDepots {
    const rows = db
        .prepare(
            `
            SELECT id, name, latitude, longitude, is_default
            FROM sites
            WHERE company_id = ? AND kind = 'depot'
            `,
        )
        .all(companyId) as Array<{
        id: number;
        name: string;
        latitude: number;
        longitude: number;
        is_default: number;
    }>;
    const byId = new Map<number, DepotAnchor>();
    let defaultDepot: DepotAnchor | null = null;

    for (const row of rows) {
        const anchor: DepotAnchor = {
            id: row.id,
            name: row.name,
            latitude: row.latitude,
            longitude: row.longitude,
        };
        byId.set(row.id, anchor);
        if (row.is_default === 1) {
            defaultDepot = anchor;
        }
    }

    return { byId, defaultDepot };
}

function placementFor(
    vehicle: MissingVehicle,
    depots: CompanyDepots,
): { latitude: number; longitude: number; label: string; speed: number } {
    const home = vehicle.home_site_id
        ? depots.byId.get(vehicle.home_site_id)
        : undefined;
    const placement = resolveStartPosition({
        depot: home ?? null,
        defaultDepot: home ? null : depots.defaultDepot,
    });

    return {
        ...placement,
        speed: speedForStatus(vehicle.status),
    };
}

/**
 * Erstpunkt für Fahrzeuge ohne `last_telemetry_id`.
 * Läuft nicht beim App-Start. Zweites Ausführen findet keine Kandidaten.
 */
export function backfillMissingPositions(options: {
    dryRun?: boolean;
    companyId?: number;
} = {}): BackfillResult {
    const dryRun = options.dryRun === true;
    const companyId = options.companyId;
    const rows = db
        .prepare(
            `
            SELECT id, company_id, status, home_site_id
            FROM vehicles
            WHERE last_telemetry_id IS NULL
              AND (? IS NULL OR company_id = ?)
            ORDER BY company_id, id
            `,
        )
        .all(companyId ?? null, companyId ?? null) as MissingVehicle[];

    const depotsByCompany = new Map<number, CompanyDepots>();
    const counts = new Map<number, Map<string, number>>();
    let inserted = 0;

    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
        const chunk = rows.slice(offset, offset + BATCH_SIZE);
        const points = chunk.map((vehicle) => {
            let depots = depotsByCompany.get(vehicle.company_id);
            if (!depots) {
                depots = loadDepots(vehicle.company_id);
                depotsByCompany.set(vehicle.company_id, depots);
            }

            const placement = placementFor(vehicle, depots);
            let companyCounts = counts.get(vehicle.company_id);
            if (!companyCounts) {
                companyCounts = new Map();
                counts.set(vehicle.company_id, companyCounts);
            }
            companyCounts.set(
                placement.label,
                (companyCounts.get(placement.label) ?? 0) + 1,
            );

            return {
                vehicleId: vehicle.id,
                latitude: placement.latitude,
                longitude: placement.longitude,
                speed: placement.speed,
            };
        });

        if (!dryRun) {
            withTransaction(() => {
                TelemetryModel.insertInitialBatch(points);
            });
            inserted += points.length;
        }
    }

    const companies: BackfillCompanyReport[] = [...counts.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([id, labels]) => {
            const byDepot = [...labels.entries()]
                .sort((left, right) => {
                    if (left[0] === "Fallback") {
                        return 1;
                    }
                    if (right[0] === "Fallback") {
                        return -1;
                    }
                    return left[0].localeCompare(right[0], "de");
                })
                .map(([label, count]) => ({ label, count }));

            return {
                companyId: id,
                total: byDepot.reduce((sum, entry) => sum + entry.count, 0),
                byDepot,
            };
        });

    return { dryRun, inserted, companies };
}
