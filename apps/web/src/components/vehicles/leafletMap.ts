import L from "leaflet";
import { isDarkTheme, onThemeChange } from "../../utils/theme";

const LIGHT_BASE =
    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const LIGHT_LABELS =
    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
const DARK_BASE =
    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const DARK_LABELS =
    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
const ATTRIBUTION =
    'Tiles &copy; <a href="https://www.esri.com/">Esri</a>';

/**
 * Place names only from city level: in the overview and the region they are
 * noise around the vehicles; on a street they help to say where one is.
 */
const LABEL_MIN_ZOOM = 10;

type TilePair = {
    base: L.TileLayer;
    labels: L.TileLayer;
};

/** The scheme the page shows (system or picked in the header). */
export const prefersDark = () => isDarkTheme();

/** A colour token from index.css, for Leaflet shapes drawn on canvas or SVG. */
export const themeColor = (name: string, fallback: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback;

const createBasemap = (dark: boolean): TilePair => {
    const baseUrl = dark ? DARK_BASE : LIGHT_BASE;
    const labelUrl = dark ? DARK_LABELS : LIGHT_LABELS;
    /*
     * During a flight over several zoom levels (a group or a search hit) the
     * map would ask for tiles at every level it passes and drop the old ones
     * before the new ones arrive: the map went black for a moment. Without
     * loading while zooming, the old tiles stay (scaled) until the flight
     * ends; a wider buffer keeps neighbours for a short pan.
     */
    const calm = { updateWhenZooming: false, keepBuffer: 4 } as const;
    // The classes tint the grey basemap into the app's blue (leafletMap.module.scss).
    const base = L.tileLayer(baseUrl, {
        attribution: ATTRIBUTION,
        maxNativeZoom: 16,
        maxZoom: 18,
        className: "fl-tiles-base",
        ...calm,
    });
    const labels = L.tileLayer(labelUrl, {
        minZoom: LABEL_MIN_ZOOM,
        maxNativeZoom: 16,
        maxZoom: 18,
        className: "fl-tiles-labels",
        ...calm,
    });

    return { base, labels };
};

/*
 * The Esri dark basemap draws land, water and roads only a few grey steps
 * apart, and the land grey depends on the tile zoom (63 at continent level,
 * 65 around zoom 6–7, 71 from zoom 8). One SVG filter per land grey spreads
 * those steps onto the Leitstelle colours, the same picture as the landing
 * page, at every zoom. The map sets the matching filter on the base layer.
 */
const landGrey = (zoom: number) => (zoom <= 4 ? 63 : zoom <= 7 ? 65 : 71);

/*
 * Land one step lighter than the page and water clearly darker, so coasts,
 * rivers and borders read at a glance (variant C on the canvas).
 */
const tileStops = (land: number): Array<[number, string]> => [
    [0, "#060a10"],
    [38, "#0a0f17"], // water (grey 34–35)
    [land - 3, "#131a26"],
    [land, "#1a2231"], // land
    [land + 3, "#222c3e"],
    [land + 8, "#303d55"], // roads and towns
    [land + 18, "#3f4e6b"],
    [land + 70, "#606e8a"],
    [255, "#b4bccc"],
];

const channels = (hex: string) =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

const tileTable = (stops: Array<[number, string]>, channel: number) =>
    Array.from({ length: 256 }, (_, value) => {
        const upper = Math.max(
            stops.findIndex(([stop]) => value <= stop),
            1,
        );
        const [v1, c1] = stops[upper];
        const [v0, c0] = stops[upper - 1];
        const t = (value - v0) / (v1 - v0 || 1);
        const a = channels(c0)[channel];
        return (a + (channels(c1)[channel] - a) * t).toFixed(4);
    }).join(" ");

/** Id of the dark tile filter for this zoom; the filter is created on first use. */
const tileFilterId = (zoom: number) => {
    const land = landGrey(Math.round(zoom));
    const id = `fl-tiles-dark-${land}`;

    if (!document.getElementById(id)) {
        const stops = tileStops(land);
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("width", "0");
        svg.setAttribute("height", "0");
        svg.style.position = "absolute";
        svg.innerHTML = `<filter id="${id}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0"/><feComponentTransfer><feFuncR type="table" tableValues="${tileTable(stops, 0)}"/><feFuncG type="table" tableValues="${tileTable(stops, 1)}"/><feFuncB type="table" tableValues="${tileTable(stops, 2)}"/></feComponentTransfer></filter>`;
        document.body.appendChild(svg);
    }

    return id;
};

/** Dark scheme: the zoom-matched filter on the base tiles; light: the CSS tint. */
const applyTileFilter = (map: L.Map, tiles: TilePair) => {
    const container = tiles.base.getContainer();

    if (container) {
        container.style.filter = prefersDark()
            ? `url(#${tileFilterId(map.getZoom())})`
            : "";
    }
};

const applyMapTheme = (container: HTMLElement) => {
    container.dataset.theme = prefersDark() ? "dark" : "light";
};

const isHistoryMouseButton = (event: MouseEvent) =>
    event.button === 3 || event.button === 4;

const allowBrowserHistoryButtons = (container: HTMLElement) => {
    const onHistoryButton = (event: MouseEvent) => {
        if (!isHistoryMouseButton(event)) {
            return;
        }

        event.stopImmediatePropagation();
    };

    container.addEventListener("mousedown", onHistoryButton, true);
    container.addEventListener("mouseup", onHistoryButton, true);

    return () => {
        container.removeEventListener("mousedown", onHistoryButton, true);
        container.removeEventListener("mouseup", onHistoryButton, true);
    };
};

const scheduleInvalidate = (
    map: L.Map,
    delays?: number[],
) => {
    if (delays && delays.length === 0) {
        return () => undefined;
    }

    const used = delays ?? [0, 120, 400];
    const invalidate = () => {
        map.invalidateSize();
    };
    const frame = requestAnimationFrame(invalidate);
    const timeouts = used
        .filter((delay) => delay > 0)
        .map((delay) => window.setTimeout(invalidate, delay));

    return () => {
        cancelAnimationFrame(frame);
        for (const timeout of timeouts) {
            window.clearTimeout(timeout);
        }
    };
};

export const createThemedMap = (
    container: HTMLElement,
    options?: {
        invalidateDelays?: number[];
        mapOptions?: L.MapOptions;
        /** Scale bar bottom left; off for a map that is only a picture. */
        scale?: boolean;
        /** Place-name layer; off where names would only add noise. */
        labels?: boolean;
    },
) => {
    applyMapTheme(container);
    const detachHistoryButtons = allowBrowserHistoryButtons(container);

    const map = L.map(container, {
        attributionControl: true,
        zoomControl: true,
        maxZoom: 18,
        // Set explicitly: otherwise Leaflet takes the smallest minZoom of the
        // layers, and while the scheme swaps the base tiles only the name
        // layer (from zoom 10) is left, so the map would jump to zoom 10.
        minZoom: 0,
        ...options?.mapOptions,
    });
    let tiles = createBasemap(prefersDark());
    tiles.base.addTo(map);
    if (options?.labels !== false) {
        tiles.labels.addTo(map);
    }

    // The base tiles need the filter that matches the current zoom.
    const syncTileFilter = () => applyTileFilter(map, tiles);
    map.on("zoomend viewreset", syncTileFilter);
    map.whenReady(syncTileFilter);

    /*
     * While a zoom loads, Leaflet keeps the coarser tiles under the new ones.
     * Under the opaque base that is invisible; the name layer is transparent,
     * so old names would shine through several times too large. Names hide
     * while zooming and only the current level shows afterwards.
     */
    const current = () => String(tiles.labels.options.maxZoom);
    const showCurrentLabels = () => {
        const container = tiles.labels.getContainer();
        if (!container) {
            return;
        }
        container.classList.remove("fl-tiles-zooming");
        for (const level of Array.from(container.children)) {
            (level as HTMLElement).style.visibility =
                (level as HTMLElement).style.zIndex === current() ? "" : "hidden";
        }
    };
    const hideLabels = () =>
        tiles.labels.getContainer()?.classList.add("fl-tiles-zooming");
    map.on("zoomstart", hideLabels);
    map.on("zoomend", showCurrentLabels);

    if (options?.scale !== false) {
        L.control
            .scale({
                imperial: false,
                metric: true,
                position: "bottomleft",
            })
            .addTo(map);
    }

    const cancelInvalidate = scheduleInvalidate(
        map,
        options?.invalidateDelays,
    );
    const themeListeners: Array<() => void> = [];

    const onScheme = () => {
        applyMapTheme(container);
        tiles.labels.remove();
        tiles.base.remove();
        tiles = createBasemap(prefersDark());
        tiles.base.addTo(map);
        if (options?.labels !== false) {
            tiles.labels.addTo(map);
        }
        syncTileFilter();
        for (const listener of themeListeners) {
            listener();
        }
    };

    const stopThemeListener = onThemeChange(onScheme);

    return {
        map,
        onThemeChange(listener: () => void) {
            themeListeners.push(listener);
        },
        destroy() {
            cancelInvalidate();
            detachHistoryButtons();
            stopThemeListener();
            map.off("zoomend viewreset", syncTileFilter);
            map.off("zoomstart", hideLabels);
            map.off("zoomend", showCurrentLabels);
            map.remove();
        },
    };
};
