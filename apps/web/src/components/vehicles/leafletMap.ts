import L from "leaflet";

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

export type TilePair = {
    base: L.TileLayer;
    labels: L.TileLayer;
};

export const prefersDark = () =>
    window.matchMedia("(prefers-color-scheme: dark)").matches;

export const createBasemap = (dark: boolean): TilePair => {
    const baseUrl = dark ? DARK_BASE : LIGHT_BASE;
    const labelUrl = dark ? DARK_LABELS : LIGHT_LABELS;
    const base = L.tileLayer(baseUrl, {
        attribution: ATTRIBUTION,
        maxZoom: 16,
    });
    const labels = L.tileLayer(labelUrl, {
        maxZoom: 16,
    });

    return { base, labels };
};

export const applyMapTheme = (container: HTMLElement) => {
    container.dataset.theme = prefersDark() ? "dark" : "light";
};

export const scheduleInvalidate = (map: L.Map) => {
    const invalidate = () => {
        map.invalidateSize();
    };
    const frame = requestAnimationFrame(invalidate);
    const timeouts = [0, 120, 400].map((delay) =>
        window.setTimeout(invalidate, delay),
    );

    return () => {
        cancelAnimationFrame(frame);
        for (const timeout of timeouts) {
            window.clearTimeout(timeout);
        }
    };
};

export const createThemedMap = (container: HTMLElement) => {
    applyMapTheme(container);

    const map = L.map(container, {
        attributionControl: true,
        zoomControl: true,
    });
    let tiles = createBasemap(prefersDark());
    tiles.base.addTo(map);
    tiles.labels.addTo(map);

    L.control
        .scale({
            imperial: false,
            metric: true,
            position: "bottomleft",
        })
        .addTo(map);

    const cancelInvalidate = scheduleInvalidate(map);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const themeListeners: Array<() => void> = [];

    const onScheme = () => {
        applyMapTheme(container);
        tiles.base.remove();
        tiles.labels.remove();
        tiles = createBasemap(media.matches);
        tiles.base.addTo(map);
        tiles.labels.addTo(map);
        for (const listener of themeListeners) {
            listener();
        }
    };

    media.addEventListener("change", onScheme);

    return {
        map,
        onThemeChange(listener: () => void) {
            themeListeners.push(listener);
        },
        destroy() {
            cancelInvalidate();
            media.removeEventListener("change", onScheme);
            map.remove();
        },
    };
};
