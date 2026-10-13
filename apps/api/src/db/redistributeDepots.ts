import type { VehicleStatus } from "@fleet-live/shared";
import { config } from "../config";
import { DEPOT_RADIUS_M } from "./companyDepots";
import { db, withTransaction } from "./database";
import { destinationPoint, haversineMeters } from "../lib/geo";
import {
    normalizeDepotKey,
    START_OFFSET_MAX_M,
    START_OFFSET_MIN_M,
} from "../lib/startPosition";
import { TelemetryModel } from "../models/telemetry.model";
import { TripModel } from "../models/trip.model";
import {
    NEAR_ROUTE_METERS,
    nearestFraction,
    pickRoute,
    pointAtFraction,
    SIM_ROUTES,
    speedLimitKmh,
    type LatLng,
    type SimRoute,
} from "../sim/routes";

const SAME_PLACE_M = 5;
const DEPOT_OFFSET_M = 2_800;

/**
 * Endpunkte der gebackenen Strecken. Neue Höfe liegen nördlich davon,
 * damit der 800-m-Kreis nicht auf der Straße liegt und der erste Tick
 * die Strecke trotzdem findet.
 */
const ROUTE_CITIES: Array<{
    name: string;
    routeId: string;
    end: "start" | "end";
}> = [
    { name: "Köln", routeId: "koeln-duesseldorf", end: "start" },
    { name: "Düsseldorf", routeId: "koeln-duesseldorf", end: "end" },
    { name: "Dortmund", routeId: "duesseldorf-dortmund", end: "end" },
    { name: "Frankfurt", routeId: "koeln-frankfurt", end: "end" },
    { name: "Stuttgart", routeId: "frankfurt-stuttgart", end: "end" },
    { name: "München", routeId: "muenchen-nuernberg", end: "start" },
    { name: "Nürnberg", routeId: "muenchen-nuernberg", end: "end" },
    { name: "Berlin", routeId: "berlin-hamburg", end: "start" },
    { name: "Hamburg", routeId: "berlin-hamburg", end: "end" },
    { name: "Bremen", routeId: "hamburg-bremen", end: "end" },
];

export class RedistributeNotAllowedError extends Error {
    constructor() {
        super(
            "Umverteilung läuft nur in der Entwicklung oder mit --force.",
        );
        this.name = "RedistributeNotAllowedError";
    }
}

export type RedistributeDepotReport = {
    name: string;
    wouldCreate: boolean;
    counts: Record<VehicleStatus, number>;
};

export type RedistributeCompanyReport = {
    companyId: number;
    updated: number;
    unchanged: number;
    depots: RedistributeDepotReport[];
};

export type RedistributeResult = {
    dryRun: boolean;
    companies: RedistributeCompanyReport[];
};

type DepotPlan = {
    name: string;
    latitude: number;
    longitude: number;
    siteId: number | null;
    wouldCreate: boolean;
    isDefault: boolean;
    custom: boolean;
};

type VehicleRow = {
    id: number;
    status: VehicleStatus;
    home_site_id: number | null;
    depot: string | null;
    telemetry_id: number | null;
    latitude: number | null;
    longitude: number | null;
    speed: number | null;
};

export type DrivingPlacement = {
    latitude: number;
    longitude: number;
    speed: number;
    /**
     * Wahr, wenn `pickRoute` von diesem Punkt dieselbe Strecke wählt,
     * auf der der Punkt liegt. Der erste Tick nach einem Neustart bleibt
     * dann auf der Strecke.
     */
    stable: boolean;
};

function mix(seed: number): number {
    let x = seed >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
    x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
    return (x ^ (x >>> 16)) >>> 0;
}

function unit(seed: number): number {
    return mix(seed) / 4_294_967_296;
}

function emptyCounts(): Record<VehicleStatus, number> {
    return { IDLE: 0, DRIVING: 0, STOPPED: 0, OFFLINE: 0 };
}

function routeEndpoint(routeId: string, end: "start" | "end"): LatLng {
    const route = SIM_ROUTES.find((entry) => entry.id === routeId);
    const point =
        end === "start"
            ? route?.points[0]
            : route?.points[route.points.length - 1];

    if (!point) {
        throw new Error(`Strecke ${routeId} hat keinen Endpunkt.`);
    }

    return point;
}

/** Geplanter Hof neben dem Streckenende. Bestehende Höfe überschreibt das nicht. */
export function plannedRedistributeDepots(): Array<{
    name: string;
    latitude: number;
    longitude: number;
}> {
    return ROUTE_CITIES.map((city) => {
        const shifted = destinationPoint(
            routeEndpoint(city.routeId, city.end),
            DEPOT_OFFSET_M,
            0,
        );

        return {
            name: city.name,
            latitude: shifted.lat,
            longitude: shifted.lng,
        };
    });
}

function canonicalCity(name: string): string | null {
    const key = normalizeDepotKey(name);
    const exact = ROUTE_CITIES.find(
        (city) => normalizeDepotKey(city.name) === key,
    );

    if (exact) {
        return exact.name;
    }

    const folded = key
        .replaceAll("ä", "a")
        .replaceAll("ö", "o")
        .replaceAll("ü", "u")
        .replaceAll("ß", "ss");
    const alias: Record<string, string> = {
        koln: "Köln",
        koeln: "Köln",
        dusseldorf: "Düsseldorf",
        duesseldorf: "Düsseldorf",
        munchen: "München",
        muenchen: "München",
        nurnberg: "Nürnberg",
        nuernberg: "Nürnberg",
    };

    return alias[folded] ?? null;
}

const nearCache = new Map<string, SimRoute[]>();

function routesByDistance(origin: LatLng): SimRoute[] {
    const key = `${origin.lat},${origin.lng}`;
    const cached = nearCache.get(key);

    if (cached) {
        return cached;
    }

    const ranked = [...SIM_ROUTES].sort(
        (left, right) =>
            distanceToRoute(left, origin) - distanceToRoute(right, origin),
    );

    nearCache.set(key, ranked);
    return ranked;
}

function distanceToRoute(route: SimRoute, pos: LatLng): number {
    const frac = nearestFraction(route.points, pos);
    return haversineMeters(pos, pointAtFraction(route.points, frac));
}

function candidateFractions(): number[] {
    const fractions: number[] = [];

    for (let step = 1; step <= 19; step += 1) {
        fractions.push(step / 20);
    }

    return fractions;
}

type RouteSample = {
    route: SimRoute;
    frac: number;
    point: LatLng;
    /** Dieselbe Auswahl wie `pickRoute`: nahe Strecken, sonst die nächste. */
    pool: SimRoute[];
};

let routeSamples: RouteSample[] | null = null;

function samplesOnRoutes(): RouteSample[] {
    if (routeSamples) {
        return routeSamples;
    }

    const built: RouteSample[] = [];

    for (const route of SIM_ROUTES) {
        for (const frac of candidateFractions()) {
            const point = pointAtFraction(route.points, frac);
            const ranked = SIM_ROUTES.map((entry) => ({
                route: entry,
                dist: distanceToRoute(entry, point),
            })).sort((left, right) => left.dist - right.dist);
            const nearby = ranked.filter(
                (entry) => entry.dist <= NEAR_ROUTE_METERS,
            );
            const pool = (nearby.length > 0 ? nearby : ranked.slice(0, 1)).map(
                (entry) => entry.route,
            );

            built.push({ route, frac, point, pool });
        }
    }

    routeSamples = built;
    return built;
}

/**
 * Fahrende liegen auf der gebackenen Strecke ihres Hofs, nicht im Kreis.
 * `pickRoute` wählt bei mehreren Strecken innerhalb von 80 km nicht immer
 * die nächste, sondern `vehicleId % Anzahl`, und die Sortierung kippt,
 * sobald der Punkt auf einer anderen Strecke liegt.
 *
 * Köln, Düsseldorf und Dortmund liegen so dicht beieinander, dass jede
 * dieser drei Strecken auf ganzer Länge noch eine Nachbarstrecke in 80 km
 * sieht. Für manche Fahrzeug-IDs gibt es dort keinen Punkt, den der erste
 * Tick behält. Die liegen auf der nächsten Strecke des Hofs; der Tick kann
 * innerhalb dieses Korridors wechseln, nicht in eine andere Stadt.
 */
export function drivingPointForDepot(
    vehicleId: number,
    depot: { latitude: number; longitude: number },
): DrivingPlacement {
    const origin = { lat: depot.latitude, lng: depot.longitude };
    const ranked = routesByDistance(origin);
    const nearby = ranked.filter(
        (route) => distanceToRoute(route, origin) <= NEAR_ROUTE_METERS,
    );
    const pool = nearby.length > 0 ? nearby : ranked.slice(0, 1);
    const preferred = pickRoute(vehicleId, origin);
    const ordered = [
        preferred,
        ...pool.filter((route) => route.id !== preferred.id),
    ];

    for (const route of ordered) {
        const stable = samplesOnRoutes().filter((sample) => {
            if (sample.route.id !== route.id) {
                return false;
            }

            if (haversineMeters(sample.point, origin) <= DEPOT_RADIUS_M) {
                return false;
            }

            const chosen = sample.pool[vehicleId % sample.pool.length];

            return chosen?.id === route.id;
        });

        if (stable.length === 0) {
            continue;
        }

        const sample = stable[mix(vehicleId) % stable.length] ?? stable[0]!;

        return {
            latitude: sample.point.lat,
            longitude: sample.point.lng,
            speed: speedLimitKmh(sample.frac),
            stable: true,
        };
    }

    const nearest = pool[0] ?? SIM_ROUTES[0]!;
    const frac = 0.2 + unit(vehicleId) * 0.6;
    const point = pointAtFraction(nearest.points, frac);

    return {
        latitude: point.lat,
        longitude: point.lng,
        speed: speedLimitKmh(frac),
        stable: false,
    };
}

export function yardPointForDepot(
    vehicleId: number,
    depot: { latitude: number; longitude: number },
): { latitude: number; longitude: number } {
    const distance =
        START_OFFSET_MIN_M +
        unit(vehicleId + 0x51ed) * (START_OFFSET_MAX_M - START_OFFSET_MIN_M);
    const bearing = unit(vehicleId + 0x9e37) * Math.PI * 2;
    const point = destinationPoint(
        { lat: depot.latitude, lng: depot.longitude },
        distance,
        bearing,
    );

    return { latitude: point.lat, longitude: point.lng };
}

function assertAllowed(force: boolean) {
    if (force || config.nodeEnv === "development") {
        return;
    }

    throw new RedistributeNotAllowedError();
}

function companyIds(only?: number): number[] {
    if (only !== undefined) {
        const company = db
            .prepare(`SELECT id FROM companies WHERE id = ?`)
            .get(only) as { id: number } | undefined;

        if (!company) {
            throw new Error(`Firma ${only} gibt es nicht.`);
        }

        return [only];
    }

    return (
        db
            .prepare(
                `
                SELECT DISTINCT company_id AS id
                FROM vehicles
                ORDER BY company_id
                `,
            )
            .all() as Array<{ id: number }>
    ).map((row) => row.id);
}

function loadSites(companyId: number): DepotPlan[] {
    const rows = db
        .prepare(
            `
            SELECT id, name, latitude, longitude, is_default
            FROM sites
            WHERE company_id = ? AND kind = 'depot'
            ORDER BY id
            `,
        )
        .all(companyId) as Array<{
        id: number;
        name: string;
        latitude: number;
        longitude: number;
        is_default: number;
    }>;
    const byCity = new Map<string, (typeof rows)[number]>();

    for (const row of rows) {
        const city = canonicalCity(row.name);

        if (city && !byCity.has(city)) {
            byCity.set(city, row);
        }
    }

    const hadDefault = rows.some((row) => row.is_default === 1);
    const plans: DepotPlan[] = plannedRedistributeDepots().map((city) => {
        const existing = byCity.get(city.name);

        if (existing) {
            return {
                name: existing.name,
                latitude: existing.latitude,
                longitude: existing.longitude,
                siteId: existing.id,
                wouldCreate: false,
                isDefault: existing.is_default === 1,
                custom: false,
            };
        }

        return {
            name: city.name,
            latitude: city.latitude,
            longitude: city.longitude,
            siteId: null,
            wouldCreate: true,
            isDefault: !hadDefault && city.name === "Köln",
            custom: false,
        };
    });

    for (const row of rows) {
        if (canonicalCity(row.name)) {
            continue;
        }

        plans.push({
            name: row.name,
            latitude: row.latitude,
            longitude: row.longitude,
            siteId: row.id,
            wouldCreate: false,
            isDefault: row.is_default === 1,
            custom: true,
        });
    }

    return plans;
}

function loadVehicles(companyId: number): VehicleRow[] {
    return db
        .prepare(
            `
            SELECT
                v.id,
                v.status,
                v.home_site_id,
                v.depot,
                t.id AS telemetry_id,
                t.latitude,
                t.longitude,
                t.speed
            FROM vehicles v
            LEFT JOIN telemetry t ON t.id = v.last_telemetry_id
            WHERE v.company_id = ?
            ORDER BY v.id
            `,
        )
        .all(companyId) as VehicleRow[];
}

function routeDepotsOf(plans: DepotPlan[]): DepotPlan[] {
    return plans
        .filter((depot) => !depot.custom)
        .sort((left, right) => left.name.localeCompare(right.name, "de"));
}

function assignDepot(
    vehicle: VehicleRow,
    plans: DepotPlan[],
    routeDepots: DepotPlan[],
): DepotPlan {
    const home =
        vehicle.home_site_id === null
            ? undefined
            : plans.find((depot) => depot.siteId === vehicle.home_site_id);

    if (home?.custom && !home.isDefault) {
        return home;
    }

    return routeDepots[mix(vehicle.id) % routeDepots.length] ?? routeDepots[0]!;
}

type Assignment = {
    vehicle: VehicleRow;
    depot: DepotPlan;
    latitude: number;
    longitude: number;
    speed: number;
    moved: boolean;
    changed: boolean;
};

function assignmentsFor(
    vehicles: VehicleRow[],
    plans: DepotPlan[],
): Assignment[] {
    const routeDepots = routeDepotsOf(plans);

    return vehicles.map((vehicle) => {
        const depot = assignDepot(vehicle, plans, routeDepots);
        const placed =
            vehicle.status === "DRIVING"
                ? drivingPointForDepot(vehicle.id, depot)
                : {
                      ...yardPointForDepot(vehicle.id, depot),
                      speed: 0,
                  };
        const origin =
            vehicle.latitude === null || vehicle.longitude === null
                ? null
                : { lat: vehicle.latitude, lng: vehicle.longitude };
        const moved =
            origin === null ||
            haversineMeters(origin, {
                lat: placed.latitude,
                lng: placed.longitude,
            }) > SAME_PLACE_M;
        const sameHome =
            vehicle.home_site_id !== null &&
            vehicle.home_site_id === depot.siteId &&
            vehicle.depot === depot.name;
        const sameSpeed =
            vehicle.speed !== null &&
            Math.abs(vehicle.speed - placed.speed) < 0.5;
        const changed = moved || !sameHome || !sameSpeed;

        return {
            vehicle,
            depot,
            latitude: placed.latitude,
            longitude: placed.longitude,
            speed: placed.speed,
            moved,
            changed,
        };
    });
}

function reportFor(
    companyId: number,
    plans: DepotPlan[],
    assigned: Assignment[],
): RedistributeCompanyReport {
    const counts = new Map<string, Record<VehicleStatus, number>>();
    const flags = new Map<string, boolean>();

    for (const depot of plans) {
        if (depot.custom && !assigned.some((row) => row.depot === depot)) {
            continue;
        }

        counts.set(depot.name, emptyCounts());
        flags.set(depot.name, depot.wouldCreate);
    }

    for (const row of assigned) {
        const bucket = counts.get(row.depot.name) ?? emptyCounts();
        bucket[row.vehicle.status] += 1;
        counts.set(row.depot.name, bucket);
        flags.set(row.depot.name, row.depot.wouldCreate);
    }

    const depots = [...counts.entries()]
        .map(([name, statusCounts]) => ({
            name,
            wouldCreate: flags.get(name) === true,
            counts: statusCounts,
        }))
        .sort((left, right) => left.name.localeCompare(right.name, "de"));

    return {
        companyId,
        updated: assigned.filter((row) => row.changed).length,
        unchanged: assigned.filter((row) => !row.changed).length,
        depots,
    };
}

function applyAssignments(
    companyId: number,
    plans: DepotPlan[],
    assigned: Assignment[],
) {
    const hadDefault =
        (
            db
                .prepare(
                    `
                    SELECT COUNT(*) AS n
                    FROM sites
                    WHERE company_id = ? AND kind = 'depot' AND is_default = 1
                    `,
                )
                .get(companyId) as { n: number }
        ).n > 0;
    const insertSite = db.prepare(
        `
        INSERT INTO sites (
            company_id, name, kind, latitude, longitude, radius_m, is_default
        )
        VALUES (?, ?, 'depot', ?, ?, ?, ?)
        `,
    );
    const updateTelemetry = db.prepare(
        `
        UPDATE telemetry
        SET latitude = ?, longitude = ?, speed = ?
        WHERE id = ?
        `,
    );
    const updateHome = db.prepare(
        `
        UPDATE vehicles
        SET home_site_id = ?, depot = ?
        WHERE id = ?
        `,
    );
    const created = new Map<string, number>();

    for (const depot of plans) {
        if (depot.custom || !depot.wouldCreate || depot.siteId !== null) {
            continue;
        }

        const isDefault = !hadDefault && depot.name === "Köln" ? 1 : 0;
        const result = insertSite.run(
            companyId,
            depot.name,
            depot.latitude,
            depot.longitude,
            DEPOT_RADIUS_M,
            isDefault,
        );
        const siteId = Number(result.lastInsertRowid);
        depot.siteId = siteId;
        created.set(depot.name, siteId);
    }

    const inserts: Array<{
        vehicleId: number;
        latitude: number;
        longitude: number;
        speed: number;
    }> = [];

    for (const row of assigned) {
        if (!row.changed) {
            continue;
        }

        const siteId = row.depot.siteId ?? created.get(row.depot.name);

        if (siteId === undefined) {
            throw new Error(
                `Hof ${row.depot.name} hat keine Id für Fahrzeug ${row.vehicle.id}.`,
            );
        }

        if (row.vehicle.telemetry_id === null) {
            inserts.push({
                vehicleId: row.vehicle.id,
                latitude: row.latitude,
                longitude: row.longitude,
                speed: row.speed,
            });
        } else {
            updateTelemetry.run(
                row.latitude,
                row.longitude,
                row.speed,
                row.vehicle.telemetry_id,
            );
        }

        updateHome.run(siteId, row.depot.name, row.vehicle.id);

        if (row.vehicle.status === "DRIVING" && row.moved) {
            TripModel.close(row.vehicle.id);
            TripModel.open(row.vehicle.id);
        }
    }

    TelemetryModel.insertInitialBatch(inserts);
}

export function redistributeDepots(
    options: { dryRun?: boolean; companyId?: number; force?: boolean } = {},
): RedistributeResult {
    assertAllowed(options.force === true);
    const dryRun = options.dryRun === true;
    const companies = companyIds(options.companyId).map((companyId) => {
        const plans = loadSites(companyId);
        const assigned = assignmentsFor(loadVehicles(companyId), plans);
        const report = reportFor(companyId, plans, assigned);

        if (!dryRun && report.updated > 0) {
            withTransaction(() =>
                applyAssignments(companyId, plans, assigned),
            );
        }

        return report;
    });

    return { dryRun, companies };
}
