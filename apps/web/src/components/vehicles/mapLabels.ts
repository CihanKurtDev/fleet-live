import type { VehicleStatus } from "@fleet-live/shared";
import { vehicleStatusLabel } from "./vehicleStatus";

/*
 * Leaflet writes a tooltip string as HTML. Plates, driver and depot names are
 * free text (typed in or imported), so every label goes through `escapeHtml`
 * here instead of reaching `bindTooltip` / `setContent` as markup.
 */

const ENTITIES: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};

export const escapeHtml = (text: string) =>
    text.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);

/** Fleet map dot: plate · driver · status. */
export const fleetTooltipHtml = (vehicle: {
    license_plate: string;
    driver_name: string | null;
    status: VehicleStatus;
}) =>
    escapeHtml(
        `${vehicle.license_plate} · ${vehicle.driver_name ?? "Kein Fahrer"} · ${vehicleStatusLabel(vehicle.status)}`,
    );

/** Detail map marker: its label · status. */
export const detailTooltipHtml = (label: string, status: VehicleStatus) =>
    escapeHtml(`${label} · ${vehicleStatusLabel(status)}`);

export const depotLabelHtml = (name: string) => escapeHtml(name);
