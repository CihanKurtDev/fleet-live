import type { GeoBBox, Site, WorkshopPlace } from "@fleet-live/shared";

import { formatCount } from "../../utils/formatCount";
import { shortDate } from "./workshopText";

/** A depot or a workshop: the places of the company on the fleet map. */
export type PlaceRef = { kind: "depot" | "workshop"; id: number };

export type BoardPlace =
    | { kind: "depot"; id: number; name: string; latitude: number; longitude: number; site: Site }
    | {
          kind: "workshop";
          id: number;
          name: string;
          latitude: number;
          longitude: number;
          workshop: WorkshopPlace;
      };

export const boardPlaces = (sites: Site[], workshops: WorkshopPlace[]): BoardPlace[] => [
    ...sites.map((site) => ({
        kind: "depot" as const,
        id: site.id,
        name: site.name,
        latitude: site.latitude,
        longitude: site.longitude,
        site,
    })),
    ...workshops.map((workshop) => ({
        kind: "workshop" as const,
        id: workshop.id,
        name: workshop.name,
        latitude: workshop.latitude,
        longitude: workshop.longitude,
        workshop,
    })),
];

export const samePlace = (a: PlaceRef | null, b: PlaceRef) => a?.kind === b.kind && a.id === b.id;

export const insideBox = (place: { latitude: number; longitude: number }, box: GeoBBox | null) =>
    box === null ||
    (place.latitude >= box.south &&
        place.latitude <= box.north &&
        place.longitude >= box.west &&
        place.longitude <= box.east);

/**
 * How much is going on at a place, for the order in the band: a workshop
 * with vehicles there or appointments, a depot by the vehicles in it and at
 * home there. Busy places first, then by name.
 */
const activity = (place: BoardPlace) =>
    place.kind === "workshop"
        ? place.workshop.vehicles_here * 1000 + place.workshop.appointments.length * 100
        : place.site.in_depot_count * 10 + place.site.home_count;

export const byActivity = (a: BoardPlace, b: BoardPlace) =>
    activity(b) - activity(a) || a.name.localeCompare(b.name, "de");

/** Under a workshop's name: who is there, and the next appointment. */
export const workshopLine = (place: WorkshopPlace) => {
    const planned = place.appointments.filter((entry) => entry.state === "PLANNED");
    const next = planned[0];
    const appointment = next
        ? `${planned.length === 1 ? "1 Termin" : `${planned.length} Termine`} · ${next.license_plate} am ${shortDate(next.planned_on)}`
        : null;
    const here =
        place.vehicles_here === 0
            ? "Kein Fahrzeug dort"
            : place.vehicles_here === 1
              ? `${place.here[0]?.license_plate ?? "1 Fahrzeug"} dort`
              : `${formatCount(place.vehicles_here)} Fahrzeuge dort`;

    return { here, appointment };
};
