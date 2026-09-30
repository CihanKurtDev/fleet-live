import {
    DEPOT_RADIUS_DEFAULT_M,
    type Site,
    type SiteInput,
    type SitePatch,
    type TelemetryPatch,
} from "@fleet-live/shared";
import { haversineMeters } from "../lib/geo";
import { ConflictError, isUniqueConstraintError, ValidationError } from "../lib/errors";
import { stmt } from "../db/statements";

export type DepotSite = {
    id: number;
    company_id: number;
    name: string;
    latitude: number;
    longitude: number;
    radius_m: number;
};

const SELECT_DEPOTS = `
    SELECT id, company_id, name, latitude, longitude, radius_m
    FROM sites
    WHERE company_id = ?
      AND kind = 'depot'
    ORDER BY name, id
`;

const SELECT_DEPOT = `
    SELECT id, company_id, name, latitude, longitude, radius_m
    FROM sites
    WHERE id = ?
      AND company_id = ?
      AND kind = 'depot'
`;

const SELECT_DEPOT_BY_NAME = `
    SELECT id, company_id, name, latitude, longitude, radius_m
    FROM sites
    WHERE company_id = ?
      AND kind = 'depot'
      AND lower(name) = ?
`;

const SELECT_VEHICLE_DEPOTS = `
    SELECT id, depot_site_id
    FROM vehicles
    WHERE company_id = ?
`;

const SET_VEHICLE_DEPOT = `
    UPDATE vehicles
    SET depot_site_id = ?
    WHERE id = ?
`;

const INSERT_SITE = `
    INSERT INTO sites (
        company_id, name, kind, latitude, longitude, radius_m
    )
    VALUES (?, ?, 'depot', ?, ?, ?)
`;

const SELECT_SITE_COUNTS = `
    SELECT
        s.id,
        COALESCE(h.cnt, 0) AS home_count,
        COALESCE(d.cnt, 0) AS in_depot_count,
        COALESCE(o.cnt, 0) AS other_home_count
    FROM sites s
    LEFT JOIN (
        SELECT home_site_id AS sid, COUNT(*) AS cnt
        FROM vehicles
        WHERE company_id = ?
          AND home_site_id IS NOT NULL
        GROUP BY home_site_id
    ) h ON h.sid = s.id
    LEFT JOIN (
        SELECT depot_site_id AS sid, COUNT(*) AS cnt
        FROM vehicles
        WHERE company_id = ?
          AND depot_site_id IS NOT NULL
        GROUP BY depot_site_id
    ) d ON d.sid = s.id
    LEFT JOIN (
        SELECT depot_site_id AS sid, COUNT(*) AS cnt
        FROM vehicles
        WHERE company_id = ?
          AND depot_site_id IS NOT NULL
          AND home_site_id IS NOT NULL
          AND home_site_id != depot_site_id
        GROUP BY depot_site_id
    ) o ON o.sid = s.id
    WHERE s.company_id = ?
      AND s.kind = 'depot'
`;

type CountRow = {
    home_count: number;
    in_depot_count: number;
    other_home_count: number;
};

const EMPTY_COUNTS: CountRow = {
    home_count: 0,
    in_depot_count: 0,
    other_home_count: 0,
};

export function nearestDepot(
    sites: DepotSite[],
    latitude: number,
    longitude: number,
): DepotSite | undefined {
    let nearest: { site: DepotSite; distance: number } | undefined;

    for (const site of sites) {
        const distance = haversineMeters(
            { lat: latitude, lng: longitude },
            { lat: site.latitude, lng: site.longitude },
        );

        if (distance > site.radius_m) {
            continue;
        }

        if (!nearest || distance < nearest.distance) {
            nearest = { site, distance };
        }
    }

    return nearest?.site;
}

export class SiteModel {
    static listDepots(companyId: number): DepotSite[] {
        return stmt(SELECT_DEPOTS).all(companyId) as DepotSite[];
    }

    static list(companyId: number): Site[] {
        const counts = this.countsBySite(companyId);

        return this.listDepots(companyId).map((site) =>
            this.toSite(site, counts.get(site.id) ?? EMPTY_COUNTS),
        );
    }

    static findDepot(companyId: number, siteId: number): DepotSite | undefined {
        return stmt(SELECT_DEPOT).get(siteId, companyId) as DepotSite | undefined;
    }

    static setDepotSite(vehicleId: number, siteId: number | null): void {
        stmt(SET_VEHICLE_DEPOT).run(siteId, vehicleId);
    }

    /**
     * Depot-Radius der Firma. Ein Tick setzt `vehicles.depot_site_id`
     * auf den nächstliegenden Kreis, in dem die Position liegt.
     * Durchfahrt schreibt keine Warnung.
     */
    static applyPatches(
        patches: Array<TelemetryPatch & { company_id: number }>,
    ): number[] {
        const notify = new Set<number>();
        const depotsByCompany = new Map<number, DepotSite[]>();
        const currentByCompany = new Map<number, Map<number, number | null>>();

        for (const patch of patches) {
            let depots = depotsByCompany.get(patch.company_id);

            if (!depots) {
                depots = this.listDepots(patch.company_id);
                depotsByCompany.set(patch.company_id, depots);
            }

            if (depots.length === 0) {
                continue;
            }

            let current = currentByCompany.get(patch.company_id);

            if (!current) {
                current = this.depotSiteIds(patch.company_id);
                currentByCompany.set(patch.company_id, current);
            }

            const next = nearestDepot(
                depots,
                patch.latitude,
                patch.longitude,
            );
            const nextId = next?.id ?? null;

            if ((current.get(patch.id) ?? null) === nextId) {
                continue;
            }

            this.setDepotSite(patch.id, nextId);
            current.set(patch.id, nextId);
            notify.add(patch.company_id);
        }

        return [...notify];
    }

    static setHome(
        vehicleId: number,
        companyId: number,
        siteId: number | null,
    ): void {
        if (siteId === null) {
            stmt(
                `
                UPDATE vehicles
                SET home_site_id = NULL, depot = NULL
                WHERE id = ? AND company_id = ?
                `,
            ).run(vehicleId, companyId);
            return;
        }

        const site = this.findDepot(companyId, siteId);

        if (!site) {
            throw new ValidationError("Depot nicht gefunden.", {
                home_site_id: "Depot nicht gefunden.",
            });
        }

        stmt(
            `
            UPDATE vehicles
            SET home_site_id = ?, depot = ?
            WHERE id = ? AND company_id = ?
            `,
        ).run(site.id, site.name, vehicleId, companyId);
    }

    static setHomeByName(
        vehicleId: number,
        companyId: number,
        name: string | null,
    ): void {
        if (name === null || name.trim() === "") {
            this.setHome(vehicleId, companyId, null);
            return;
        }

        const site = stmt(SELECT_DEPOT_BY_NAME).get(
            companyId,
            name.trim().toLowerCase(),
        ) as DepotSite | undefined;

        if (site) {
            this.setHome(vehicleId, companyId, site.id);
            return;
        }

        stmt(
            `
            UPDATE vehicles
            SET home_site_id = NULL, depot = ?
            WHERE id = ? AND company_id = ?
            `,
        ).run(name.trim(), vehicleId, companyId);
    }

    static syncHome(
        vehicleId: number,
        companyId: number,
        input: { home_site_id?: number | null; depot?: string | null },
    ): void {
        if (input.home_site_id !== undefined) {
            this.setHome(vehicleId, companyId, input.home_site_id);
            return;
        }

        if (input.depot !== undefined) {
            this.setHomeByName(vehicleId, companyId, input.depot);
        }
    }

    static create(companyId: number, input: SiteInput): Site {
        try {
            const result = stmt(INSERT_SITE).run(
                companyId,
                input.name,
                input.latitude,
                input.longitude,
                input.radius_m ?? DEPOT_RADIUS_DEFAULT_M,
            );
            const id = Number(result.lastInsertRowid);
            this.refreshInside(companyId);
            const created = this.findDepot(companyId, id);

            if (!created) {
                throw new Error("Created depot was not found.");
            }

            return this.toSite(
                created,
                this.countsBySite(companyId).get(id) ?? EMPTY_COUNTS,
            );
        } catch (error) {
            if (isUniqueConstraintError(error)) {
                throw new ConflictError("Ein Depot mit diesem Namen gibt es schon.", {
                    name: "Ein Depot mit diesem Namen gibt es schon.",
                });
            }

            throw error;
        }
    }

    static update(
        id: number,
        companyId: number,
        input: SitePatch,
    ): Site | undefined {
        const current = this.findDepot(companyId, id);

        if (!current) {
            return undefined;
        }

        const name = input.name ?? current.name;
        const latitude = input.latitude ?? current.latitude;
        const longitude = input.longitude ?? current.longitude;
        const radius = input.radius_m ?? current.radius_m;

        try {
            stmt(
                `
                UPDATE sites
                SET name = ?, latitude = ?, longitude = ?, radius_m = ?
                WHERE id = ? AND company_id = ?
                `,
            ).run(name, latitude, longitude, radius, id, companyId);
        } catch (error) {
            if (isUniqueConstraintError(error)) {
                throw new ConflictError("Ein Depot mit diesem Namen gibt es schon.", {
                    name: "Ein Depot mit diesem Namen gibt es schon.",
                });
            }

            throw error;
        }

        stmt(
            `
            UPDATE vehicles
            SET depot = ?
            WHERE home_site_id = ? AND company_id = ?
            `,
        ).run(name, id, companyId);
        this.refreshInside(companyId);

        const updated = this.findDepot(companyId, id);
        return updated
            ? this.toSite(
                  updated,
                  this.countsBySite(companyId).get(id) ?? EMPTY_COUNTS,
              )
            : undefined;
    }

    static delete(id: number, companyId: number): boolean {
        const current = this.findDepot(companyId, id);

        if (!current) {
            return false;
        }

        stmt(
            `
            UPDATE vehicles
            SET home_site_id = NULL, depot = NULL
            WHERE home_site_id = ? AND company_id = ?
            `,
        ).run(id, companyId);
        stmt(
            `
            UPDATE vehicles
            SET depot_site_id = NULL
            WHERE depot_site_id = ?
            `,
        ).run(id);
        stmt(`DELETE FROM sites WHERE id = ? AND company_id = ?`).run(
            id,
            companyId,
        );
        this.refreshInside(companyId);
        return true;
    }

    /** Letzte Positionen neu gegen die Kreise der Firma legen. */
    static refreshInside(companyId: number): void {
        const sites = this.listDepots(companyId);
        const rows = stmt(
            `
            SELECT v.id, t.latitude, t.longitude
            FROM vehicles v
            INNER JOIN telemetry t ON t.id = v.last_telemetry_id
            WHERE v.company_id = ?
            `,
        ).all(companyId) as Array<{
            id: number;
            latitude: number;
            longitude: number;
        }>;

        const setSite = stmt(SET_VEHICLE_DEPOT);

        for (const row of rows) {
            const inside = nearestDepot(sites, row.latitude, row.longitude);
            setSite.run(inside?.id ?? null, row.id);
        }
    }

    private static depotSiteIds(companyId: number): Map<number, number | null> {
        const rows = stmt(SELECT_VEHICLE_DEPOTS).all(companyId) as Array<{
            id: number;
            depot_site_id: number | null;
        }>;

        return new Map(rows.map((row) => [row.id, row.depot_site_id]));
    }

    private static countsBySite(companyId: number): Map<number, CountRow> {
        const rows = stmt(SELECT_SITE_COUNTS).all(
            companyId,
            companyId,
            companyId,
            companyId,
        ) as Array<{
            id: number;
            home_count: number;
            in_depot_count: number;
            other_home_count: number;
        }>;

        return new Map(
            rows.map((row) => [
                row.id,
                {
                    home_count: Number(row.home_count),
                    in_depot_count: Number(row.in_depot_count),
                    other_home_count: Number(row.other_home_count),
                },
            ]),
        );
    }

    private static toSite(site: DepotSite, counts: CountRow): Site {
        return {
            id: site.id,
            name: site.name,
            latitude: site.latitude,
            longitude: site.longitude,
            radius_m: site.radius_m,
            home_count: counts.home_count,
            in_depot_count: counts.in_depot_count,
            other_home_count: counts.other_home_count,
        };
    }
}
