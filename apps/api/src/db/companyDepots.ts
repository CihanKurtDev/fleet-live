import type { DatabaseSync } from "node:sqlite";
import { haversineMeters } from "../lib/geo";

/** Hof-Radius. Klein genug, dass nur Fahrzeuge am Platz zählen, nicht die Stadt. */
export const DEPOT_RADIUS_M = 800;

/**
 * Firmenhöfe neben der Stadt, nicht auf den Sim-Strecken.
 * Die Routen starten in der Innenstadt; ein Kreis dort würde Durchfahrt
 * als „Im Depot“ zählen.
 */
export const COMPANY_DEPOTS = [
    { companyId: 1, name: "Köln", latitude: 50.89, longitude: 6.905 },
    { companyId: 2, name: "Düsseldorf", latitude: 51.195, longitude: 6.72 },
    { companyId: 3, name: "München", latitude: 48.095, longitude: 11.52 },
] as const;

const PARKED_PER_DEPOT = 8;

type Parkable = {
    id: number;
    companyId: number;
    status: string;
};

export function replaceCompanyDepots(database: DatabaseSync): void {
    database.exec("DELETE FROM sites");

    const insert = database.prepare(`
        INSERT INTO sites (
            company_id, name, kind, latitude, longitude, radius_m
        )
        VALUES (?, ?, 'depot', ?, ?, ?)
    `);

    for (const depot of COMPANY_DEPOTS) {
        insert.run(
            depot.companyId,
            depot.name,
            depot.latitude,
            depot.longitude,
            DEPOT_RADIUS_M,
        );
    }
}

/**
 * Stehende Fahrzeuge an den Hof setzen, damit Kreis und „Im Depot“ sichtbar sind.
 * Fahrende bleiben auf der Strecke. Durchfahrt erzeugt keine Warnung.
 */
export function parkIdleAtDepots(
    database: DatabaseSync,
    vehicles: Parkable[],
): void {
    const move = database.prepare(`
        UPDATE telemetry
        SET latitude = ?, longitude = ?
        WHERE id = (SELECT last_telemetry_id FROM vehicles WHERE id = ?)
    `);
    const assignHome = database.prepare(`
        UPDATE vehicles
        SET home_site_id = ?, depot = ?
        WHERE id = ?
    `);
    const findSite = database.prepare(`
        SELECT id FROM sites WHERE company_id = ? AND name = ?
    `);

    for (const depot of COMPANY_DEPOTS) {
        const site = findSite.get(depot.companyId, depot.name) as
            | { id: number }
            | undefined;

        if (!site) {
            continue;
        }

        const parked = vehicles
            .filter(
                (vehicle) =>
                    vehicle.companyId === depot.companyId &&
                    vehicle.status !== "OFFLINE" &&
                    vehicle.status !== "DRIVING",
            )
            .slice(0, PARKED_PER_DEPOT);

        parked.forEach((vehicle, index) => {
            const lat = depot.latitude + (index - 3) * 0.00035;
            const lng = depot.longitude + (index % 3) * 0.00035;
            move.run(lat, lng, vehicle.id);
            assignHome.run(site.id, depot.name, vehicle.id);
        });
    }
}

/** `depot_site_id` aus der letzten Position und den Firmen-Depots. */
export function assignDepotSitesFromTelemetry(database: DatabaseSync): void {
    const sites = database
        .prepare(
            `
            SELECT id, company_id, latitude, longitude, radius_m
            FROM sites
            WHERE kind = 'depot'
            `,
        )
        .all() as Array<{
        id: number;
        company_id: number;
        latitude: number;
        longitude: number;
        radius_m: number;
    }>;
    const rows = database
        .prepare(
            `
            SELECT v.id, v.company_id, t.latitude, t.longitude
            FROM vehicles v
            INNER JOIN telemetry t ON t.id = v.last_telemetry_id
            `,
        )
        .all() as Array<{
        id: number;
        company_id: number;
        latitude: number;
        longitude: number;
    }>;
    const setSite = database.prepare(
        "UPDATE vehicles SET depot_site_id = ? WHERE id = ?",
    );

    for (const row of rows) {
        let siteId: number | null = null;
        let best = Number.POSITIVE_INFINITY;

        for (const site of sites) {
            if (site.company_id !== row.company_id) {
                continue;
            }

            const distance = haversineMeters(
                { lat: row.latitude, lng: row.longitude },
                { lat: site.latitude, lng: site.longitude },
            );

            if (distance <= site.radius_m && distance < best) {
                best = distance;
                siteId = site.id;
            }
        }

        setSite.run(siteId, row.id);
    }
}

/**
 * Stammstandort der Firma. Die meisten Fahrzeuge gehören zum Hof,
 * auch wenn sie gerade unterwegs sind. Ein kleiner Rest bleibt ohne.
 */
export function assignHomeSites(
    database: DatabaseSync,
    vehicles: Array<{ id: number; companyId: number; skipHome?: boolean }>,
): void {
    const findSite = database.prepare(
        `
        SELECT id, name
        FROM sites
        WHERE company_id = ? AND name = ?
        `,
    );
    const setHome = database.prepare(
        `
        UPDATE vehicles
        SET home_site_id = ?, depot = ?
        WHERE id = ?
        `,
    );

    for (const depot of COMPANY_DEPOTS) {
        const site = findSite.get(depot.companyId, depot.name) as
            | { id: number; name: string }
            | undefined;

        if (!site) {
            continue;
        }

        for (const vehicle of vehicles) {
            if (vehicle.companyId !== depot.companyId || vehicle.skipHome) {
                continue;
            }

            setHome.run(site.id, site.name, vehicle.id);
        }
    }
}
