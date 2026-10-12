import { useEffect, useMemo, useRef, useState } from "react";
import {
    clusterIndexDelay,
    createFleetClusterIndex,
    type ClusterPoint,
    type FleetClusterIndex,
} from "./clusterFleet";

/**
 * Ein Index pro Datenstand. Neue Fahrzeug-IDs bauen ihn sofort.
 * Laufende Positions-Patches bauen ihn höchstens einmal pro Wartezeit,
 * nicht bei jedem Tick.
 */
export function useClusterIndex(
    points: readonly ClusterPoint[],
): FleetClusterIndex {
    const ids = useMemo(() => points.map((point) => point.id), [points]);
    const idsRef = useRef(ids);
    const pointsRef = useRef(points);
    const timerRef = useRef<number | undefined>(undefined);
    const [source, setSource] = useState(points);

    pointsRef.current = points;

    useEffect(() => {
        const delay = clusterIndexDelay(idsRef.current, ids);
        idsRef.current = ids;

        if (delay === 0) {
            if (timerRef.current !== undefined) {
                window.clearTimeout(timerRef.current);
                timerRef.current = undefined;
            }
            setSource(pointsRef.current);
            return;
        }

        if (timerRef.current !== undefined) {
            return;
        }

        timerRef.current = window.setTimeout(() => {
            timerRef.current = undefined;
            setSource(pointsRef.current);
        }, delay);
    }, [ids, points]);

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
