import { useEffect, useMemo, useRef, useState } from "react";
import { useLatestRef } from "../../hooks/useLatestRef";
import {
    clusterIndexDelay,
    createFleetClusterIndex,
    type ClusterPoint,
    type FleetClusterIndex,
} from "./clusterFleet";

/**
 * Ein Index pro Datenstand. Neue Fahrzeug-IDs bauen ihn sofort.
 * Laufende Positions-Patches bauen ihn höchstens einmal pro Wartezeit,
 * nicht bei jedem Patch. `current` setzt beim Bauen die Positionen ein, an
 * denen die Fahrzeuge gerade gezeigt werden (nicht die letzte Meldung), damit
 * die Gruppen mit den Punkten mitfahren.
 */
export function useClusterIndex(
    points: readonly ClusterPoint[],
    current: (points: readonly ClusterPoint[]) => readonly ClusterPoint[] = (
        latest,
    ) => latest,
): FleetClusterIndex {
    const ids = useMemo(() => points.map((point) => point.id), [points]);
    const idsRef = useRef(ids);
    const pointsRef = useLatestRef(points);
    const currentRef = useLatestRef(current);
    const timerRef = useRef<number | undefined>(undefined);
    const [source, setSource] = useState(points);

    useEffect(() => {
        const delay = clusterIndexDelay(idsRef.current, ids);
        idsRef.current = ids;

        if (delay === 0) {
            if (timerRef.current !== undefined) {
                window.clearTimeout(timerRef.current);
                timerRef.current = undefined;
            }
            setSource(currentRef.current(pointsRef.current));
            return;
        }

        if (timerRef.current !== undefined) {
            return;
        }

        timerRef.current = window.setTimeout(() => {
            timerRef.current = undefined;
            setSource(currentRef.current(pointsRef.current));
        }, delay);
    }, [ids, points, currentRef, pointsRef]);

    useEffect(
        () => () => {
            if (timerRef.current !== undefined) {
                window.clearTimeout(timerRef.current);
            }
        },
        [],
    );

    return useMemo(() => createFleetClusterIndex(source), [source]);
}
