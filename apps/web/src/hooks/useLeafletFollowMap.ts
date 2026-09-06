import { useCallback, useEffect, useRef, useState } from "react";
import type L from "leaflet";

import { createThemedMap } from "../components/vehicles/leafletMap";

export const INITIAL_MAP_ZOOM = 14;

export const useLeafletFollowMap = () => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const themedRef = useRef<ReturnType<typeof createThemedMap> | null>(null);
    const followRef = useRef(true);
    const skipViewRef = useRef(false);
    const followAtRef = useRef<L.LatLng | null>(null);
    const [following, setFollowing] = useState(true);

    const setViewSilent = useCallback((
        at: L.LatLng,
        zoom?: number,
        options?: L.ZoomPanOptions,
    ) => {
        const map = mapRef.current;

        if (!map) {
            return;
        }

        followAtRef.current = at;
        skipViewRef.current = true;
        map.setView(at, zoom ?? map.getZoom(), { animate: false, ...options });
        skipViewRef.current = false;
    }, []);

    useEffect(() => {
        const container = containerRef.current;

        if (!container) {
            return;
        }

        const themed = createThemedMap(container);
        themedRef.current = themed;
        mapRef.current = themed.map;

        const onUserView = () => {
            if (skipViewRef.current) {
                return;
            }

            followRef.current = false;
            followAtRef.current = null;
            setFollowing(false);
        };

        const onResize = () => {
            const at = followAtRef.current;

            if (!followRef.current || !at) {
                return;
            }

            const zoom = themed.map.getZoom();
            setViewSilent(at, zoom < 2 ? INITIAL_MAP_ZOOM : zoom);
        };

        themed.map.on("dragstart", onUserView);
        themed.map.on("zoomstart", onUserView);
        themed.map.on("resize", onResize);

        return () => {
            themed.map.off("dragstart", onUserView);
            themed.map.off("zoomstart", onUserView);
            themed.map.off("resize", onResize);
            themed.destroy();
            themedRef.current = null;
            mapRef.current = null;
            followAtRef.current = null;
        };
    }, [setViewSilent]);

    const panIfFollowing = useCallback((at: L.LatLng) => {
        const map = mapRef.current;

        if (!map || !followRef.current) {
            return;
        }

        followAtRef.current = at;

        const origin = map.project(map.getCenter());
        const target = map.project(at);
        const dx = target.x - origin.x;
        const dy = target.y - origin.y;

        if (dx * dx + dy * dy < 0.25) {
            return;
        }

        skipViewRef.current = true;
        map.panBy([dx, dy], { animate: false, noMoveStart: true });
        skipViewRef.current = false;
    }, []);

    const recenter = useCallback(
        (at: L.LatLng) => {
            followRef.current = true;
            setFollowing(true);
            setViewSilent(at, undefined, { animate: false });
        },
        [setViewSilent],
    );

    return {
        containerRef,
        mapRef,
        themedRef,
        following,
        panIfFollowing,
        recenter,
        setViewSilent,
    };
};
