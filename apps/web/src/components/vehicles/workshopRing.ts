import L from "leaflet";

import { themeColor } from "./leafletMap";
import { depotLabelHtml } from "./mapLabels";
import styles from "./leafletMap.module.scss";

export type MapWorkshop = {
    id?: number;
    name: string;
    latitude: number;
    longitude: number;
    radius_m: number;
};

/**
 * A workshop on a map: its circle dashed (a depot's is solid), a dot that
 * stays visible when the circle is too small to see, and the name.
 */
export const drawWorkshop = (group: L.LayerGroup, place: MapWorkshop, pane?: string, selected = false) => {
    // The workshop picked on the fleet map is drawn in the selection yellow.
    const ink = selected ? themeColor("--accent-fill", "#ffc24b") : themeColor("--text-h", "#eef1f7");
    const at: L.LatLngExpression = [place.latitude, place.longitude];

    L.circle(at, {
        radius: place.radius_m,
        color: ink,
        weight: selected ? 2 : 1.4,
        dashArray: "5 4",
        fillColor: ink,
        fillOpacity: 0.05,
        interactive: false,
    }).addTo(group);
    L.circleMarker(at, {
        radius: 3,
        color: ink,
        fillColor: ink,
        fillOpacity: 1,
        weight: 0,
        interactive: false,
    }).addTo(group);
    L.tooltip({
        permanent: true,
        direction: "right",
        offset: [8, 0],
        className: styles.depotLabel,
        interactive: false,
        ...(pane ? { pane } : {}),
    })
        .setLatLng(at)
        .setContent(depotLabelHtml(`Werkstatt · ${place.name}`))
        .addTo(group);
};
