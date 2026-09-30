import { z } from "zod";
import { DEPOT_MAX } from "./vehicle";

/** Voreinstellung, klein genug für einen Hof und groß genug zum Sehen. */
export const DEPOT_RADIUS_DEFAULT_M = 800;
export const DEPOT_RADIUS_MIN_M = 200;
export const DEPOT_RADIUS_MAX_M = 5_000;
/** Darüber zählt ein großer Teil der Stadt als Depot. */
export const DEPOT_RADIUS_WARN_M = 2_500;

export type Site = {
    id: number;
    name: string;
    latitude: number;
    longitude: number;
    radius_m: number;
    /** Fahrzeuge mit diesem Stammstandort. */
    home_count: number;
    /** Fahrzeuge, deren letzte Position in diesem Kreis liegt. */
    in_depot_count: number;
    /** Davon mit einem anderen Stammstandort. */
    other_home_count: number;
};

export type SiteInput = {
    name: string;
    latitude: number;
    longitude: number;
    radius_m?: number;
};

export type SitePatch = Partial<SiteInput>;

export type SiteListResponse = {
    data: Site[];
};

const nameSchema = z
    .string()
    .trim()
    .min(1, "Name darf nicht leer sein.")
    .max(DEPOT_MAX, `Name darf höchstens ${DEPOT_MAX} Zeichen haben.`);

const latitudeSchema = z
    .number({ error: "Breitengrad muss eine Zahl sein." })
    .min(-90, "Breitengrad ist ungültig.")
    .max(90, "Breitengrad ist ungültig.");

const longitudeSchema = z
    .number({ error: "Längengrad muss eine Zahl sein." })
    .min(-180, "Längengrad ist ungültig.")
    .max(180, "Längengrad ist ungültig.");

const radiusSchema = z
    .number({ error: "Radius muss eine Zahl sein." })
    .int("Radius muss eine ganze Zahl sein.")
    .min(DEPOT_RADIUS_MIN_M, `Radius muss mindestens ${DEPOT_RADIUS_MIN_M} m sein.`)
    .max(DEPOT_RADIUS_MAX_M, `Radius darf höchstens ${DEPOT_RADIUS_MAX_M} m sein.`);

export const siteInputSchema = z.object({
    name: nameSchema,
    latitude: latitudeSchema,
    longitude: longitudeSchema,
    radius_m: radiusSchema.optional(),
});

export const sitePatchSchema = siteInputSchema.partial().refine(
    (value) => Object.keys(value).length > 0,
    { message: "Keine Änderung angegeben." },
);

export function parseSiteInput(input: unknown): SiteInput {
    return siteInputSchema.parse(input);
}

export function parseSitePatch(input: unknown): SitePatch {
    return sitePatchSchema.parse(input);
}
