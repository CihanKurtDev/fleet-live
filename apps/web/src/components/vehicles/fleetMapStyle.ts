import L from "leaflet";
import {
    decodePolyline,
    type SimRouteLine,
    type VehicleStatus,
} from "@fleet-live/shared";

import { prefersDark, themeColor } from "./leafletMap";
import { vehicleStatusColor } from "./vehicleStatus";

/*
 * How the fleet is drawn on a Leaflet map. The fleet map and the live band
 * on Schicht share it, so both show the same picture.
 */

/** Depot circles; `--depot` in index.css is the same colour for the list. */
export const depotColor = () => themeColor("--depot", "#7f9bb8");

export const markerStroke = () => (prefersDark() ? "#0b0f16" : "#ffffff");

/**
 * Vehicles are small dots in their status colour without an outline, like
 * the landing page. The selected one gets the yellow marking as a ring.
 * `grouped` marks the members of the group that was just opened with a thin
 * ring in the text colour, so they stand out among the dots that opened with
 * them. Not yellow: around a 4 px dot a yellow ring reads as the dot's colour,
 * and yellow is Standby, so an opened group of driving vehicles looked parked.
 */
export const markerStyle = (
    status: VehicleStatus,
    selected: boolean,
    grouped = false,
) => ({
    radius: selected ? 7 : grouped ? 5 : 4,
    color: selected
        ? themeColor("--accent-fill", "#ffc24b")
        : grouped
          ? themeColor("--text-h", "#eef1f7")
          : markerStroke(),
    weight: selected ? 3 : grouped ? 1.5 : 1,
    opacity: selected || grouped ? 1 : 0.6,
    fillColor: vehicleStatusColor(status),
    fillOpacity: 1,
});

/** A company depot as a thin ring; `selected` draws it stronger. */
export const depotStyle = (selected: boolean) => ({
    color: depotColor(),
    weight: selected ? 2.5 : 1,
    opacity: selected ? 1 : 0.7,
    fillColor: depotColor(),
    fillOpacity: selected ? 0.16 : 0.1,
});

/**
 * The roads the fleet drives on, under the dots: the strongest line on the
 * map, so it is clear at once where vehicles are on the way.
 */
const routeColor = () => (prefersDark() ? "#4d6798" : "#93a2b9");
/** Wider from city level, where the line runs along a real street. */
const routeWeight = (zoom: number) => (zoom >= 10 ? 5 : 3.5);
/*
 * The line is simplified to 40 m; at street level it would run beside the
 * real street, and the tiles draw the streets there anyway.
 */
const ROUTE_HIDE_ZOOM = 13;
const routeOpacity = (zoom: number) => (zoom >= ROUTE_HIDE_ZOOM ? 0 : 1);

/**
 * Draws the simulator's roads in their own pane below the vehicles, so the
 * map shows roads at every zoom, also where the tiles have none.
 */
export const addRouteLines = (map: L.Map, routes: SimRouteLine[]) => {
    const paneName = "fl-routes";

    if (!map.getPane(paneName)) {
        const pane = map.createPane(paneName);
        pane.style.zIndex = "390";
        pane.style.pointerEvents = "none";
        pane.style.transition = "opacity 180ms ease-out";
    }

    const renderer = L.svg({ pane: paneName });
    const group = L.layerGroup(
        routes.map((route) =>
            L.polyline(decodePolyline(route.path).map((p) => [p.lat, p.lng]), {
                pane: paneName,
                renderer,
                interactive: false,
                color: routeColor(),
                weight: routeWeight(map.getZoom()),
                opacity: routeOpacity(map.getZoom()),
                lineCap: "round",
                lineJoin: "round",
            }),
        ),
    ).addTo(map);
    const restyle = () =>
        group.eachLayer((layer) =>
            (layer as L.Polyline).setStyle({
                color: routeColor(),
                weight: routeWeight(map.getZoom()),
                opacity: routeOpacity(map.getZoom()),
            }),
        );
    /*
     * While the map zooms, Leaflet scales the drawn lines with it. Over one
     * level that is fine; over several (a flight) a 5 px road became a wide
     * blurred band. The lines step out once the zoom has moved a whole level
     * and come back, redrawn, when it ends.
     */
    const pane = map.getPane(paneName)!;
    let zoomFrom = map.getZoom();
    const onZoomStart = () => {
        zoomFrom = map.getZoom();
    };
    // A flight reports every step (`zoom`); a wheel or button zoom announces
    // its target before the animation (`zoomanim`).
    const onZoom = (event: L.LeafletEvent) => {
        const target = (event as L.ZoomAnimEvent).zoom ?? map.getZoom();

        if (Math.abs(target - zoomFrom) >= 1) {
            pane.style.opacity = "0";
        }
    };
    const onZoomEnd = () => {
        restyle();
        pane.style.opacity = "";
    };
    map.on("zoomstart", onZoomStart);
    map.on("zoom zoomanim", onZoom);
    map.on("zoomend", onZoomEnd);

    return {
        remove: () => {
            map.off("zoomstart", onZoomStart);
            map.off("zoom zoomanim", onZoom);
            map.off("zoomend", onZoomEnd);
            pane.style.opacity = "";
            group.remove();
        },
        restyle,
    };
};
