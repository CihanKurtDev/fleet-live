import { useEffect, useRef } from "react";
import L from "leaflet";

import { listSimRoutes } from "../../api/sim";
import { addRouteLines } from "./fleetMapStyle";
import { createThemedMap, themeColor } from "./leafletMap";
import styles from "./workshop.module.scss";

export type PickedPoint = { latitude: number; longitude: number };

interface PlacePickerMapProps {
    point: PickedPoint | null;
    radiusM: number;
    /** Where the map opens when no point is set yet (the vehicle). */
    center?: PickedPoint | null;
    label: string;
    onPick: (point: PickedPoint) => void;
}

const GERMANY: L.LatLngExpression = [51.16, 10.45];

/**
 * A small map to set a place by clicking: the circle shows the area in which
 * a parked vehicle counts as there. The roads the fleet drives on are drawn,
 * so a place next to them is easy to find.
 */
export const PlacePickerMap = ({ point, radiusM, center, label, onPick }: PlacePickerMapProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const circleRef = useRef<L.Circle | null>(null);
    const dotRef = useRef<L.CircleMarker | null>(null);
    const onPickRef = useRef(onPick);
    const startRef = useRef({ point, center });

    useEffect(() => {
        onPickRef.current = onPick;
    }, [onPick]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }

        const themed = createThemedMap(container, {
            invalidateDelays: [0, 200, 500],
            labels: true,
            mapOptions: { zoomSnap: 0.25 },
        });
        const map = themed.map;
        const start = startRef.current.point ?? startRef.current.center;
        if (start) {
            map.setView([start.latitude, start.longitude], 15);
        } else {
            map.setView(GERMANY, 6);
        }
        map.on("click", (event: L.LeafletMouseEvent) =>
            onPickRef.current({ latitude: event.latlng.lat, longitude: event.latlng.lng }),
        );
        mapRef.current = map;

        let gone = false;
        let routes: ReturnType<typeof addRouteLines> | null = null;
        listSimRoutes()
            .then((response) => {
                if (!gone) {
                    routes = addRouteLines(map, response.data);
                }
            })
            .catch(() => undefined);

        return () => {
            gone = true;
            routes?.remove();
            circleRef.current = null;
            dotRef.current = null;
            mapRef.current = null;
            themed.destroy();
        };
    }, []);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) {
            return;
        }

        circleRef.current?.remove();
        dotRef.current?.remove();
        circleRef.current = null;
        dotRef.current = null;

        if (!point) {
            return;
        }

        const ink = themeColor("--text-h", "#eef1f7");
        const at: L.LatLngExpression = [point.latitude, point.longitude];
        // A point set from outside the view (an address search): go there.
        if (!map.getBounds().contains(at)) {
            map.setView(at, 16);
        }
        // Radius 0: a spot (where a damage happened), not an area.
        circleRef.current = radiusM <= 0 ? null : L.circle(at, {
            radius: radiusM,
            color: ink,
            weight: 1.4,
            dashArray: "5 4",
            fillColor: ink,
            fillOpacity: 0.06,
            interactive: false,
        }).addTo(map);
        dotRef.current = L.circleMarker(at, {
            radius: radiusM <= 0 ? 6 : 4,
            color: ink,
            fillColor: ink,
            fillOpacity: 1,
            weight: 0,
            interactive: false,
        }).addTo(map);
    }, [point, radiusM]);

    return (
        <div
            ref={containerRef}
            className={styles.pickerMap}
            role="application"
            aria-label={label}
        />
    );
};
