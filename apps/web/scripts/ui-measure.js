/**
 * Read-only layout and accessibility measurements for the running app.
 *
 * Load it in the browser console of the dev server:
 *   const m = (await import("/scripts/ui-measure.js")).default;
 *   await m.sweep(["/vehicles", "/alerts"]);
 *
 * Nothing here writes to the page or the API. See `.claude/rules/testing.md`.
 */

const parseColor = (value) => {
    const rgb = value.match(/rgba?\(([^)]+)\)/);
    if (rgb) {
        const p = rgb[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return [p[0], p[1], p[2], p[3] ?? 1];
    }
    const srgb = value.match(/color\(srgb ([^)]+)\)/);
    if (srgb) {
        const p = srgb[1].replace("/", " ").split(/\s+/).filter(Boolean).map(Number);
        return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1];
    }
    return null;
};

const luminance = ([r, g, b]) => {
    const f = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

export const contrastRatio = (a, b) => {
    const l1 = luminance(a);
    const l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

const blend = (top, base) =>
    [0, 1, 2].map((k) => top[k] * top[3] + base[k] * (1 - top[3]));

/** The opaque colour behind an element, alpha layers flattened. */
export const backgroundOf = (element) => {
    const layers = [];
    let node = element;
    while (node && node.nodeType === 1) {
        const color = parseColor(getComputedStyle(node).backgroundColor);
        if (color && color[3] > 0) {
            layers.push(color);
            if (color[3] >= 1) break;
        }
        node = node.parentElement;
    }
    let base = parseColor(getComputedStyle(document.documentElement).backgroundColor);
    if (!base || base[3] === 0) base = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i -= 1) base = blend(layers[i], base);
    return base;
};

const visible = (element) => {
    const r = element.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) return false;
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && Number(style.opacity) !== 0;
};

const label = (element) =>
    (element.getAttribute("aria-label") || element.placeholder || element.textContent || element.tagName)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 24);

/** Text below WCAG 1.4.3 (4.5:1, large text 3:1). */
export const textContrast = () => {
    const hits = [];
    for (const element of document.querySelectorAll("body *")) {
        const hasText = [...element.childNodes].some(
            (n) => n.nodeType === 3 && n.textContent.trim().length > 1,
        );
        if (!hasText || !visible(element)) continue;
        const style = getComputedStyle(element);
        const fg = parseColor(style.color);
        if (!fg) continue;
        const bg = backgroundOf(element);
        const ratio = contrastRatio(blend(fg, bg), bg);
        const size = parseFloat(style.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
        if (ratio < (large ? 3 : 4.5)) {
            hits.push({ text: label(element), ratio: Number(ratio.toFixed(2)), size, color: style.color });
        }
    }
    return hits;
};

const GROUP_SELECTOR =
    "header,section,dialog,[class*=toolbar],[class*=Toolbar],[class*=actions],[class*=bar],[class*=Bar],[class*=footer],[class*=head]";
const CONTROL_SELECTOR =
    "button,input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]),select";

/**
 * Controls that sit on one line inside one group but differ in height or
 * vertical centre by more than 1 px.
 */
export const alignment = () => {
    const groups = [];
    for (const element of document.querySelectorAll(CONTROL_SELECTOR)) {
        if (!visible(element)) continue;
        if (element.closest(".leaflet-container,tbody,[role=menu],[class*=tile],[class*=Tile]")) continue;
        const r = element.getBoundingClientRect();
        if (r.height > 70 || r.height < 8) continue;
        const parent = element.closest(GROUP_SELECTOR);
        const group = groups.find((g) => g.parent === parent && Math.abs(g.top - r.top) < 20);
        if (group) group.items.push(element);
        else groups.push({ parent, top: r.top, items: [element] });
    }
    return groups
        .filter((g) => g.items.length > 1)
        .map((g) => {
            const rects = g.items.map((e) => e.getBoundingClientRect());
            const heights = rects.map((r) => r.height);
            const centres = rects.map((r) => r.top + r.height / 2);
            return {
                where: String(g.parent?.className || g.parent?.tagName || "?").split(" ")[0],
                heightDiff: Math.round(Math.max(...heights) - Math.min(...heights)),
                centreDiff: Math.round((Math.max(...centres) - Math.min(...centres)) * 10) / 10,
                items: g.items.map((e, i) => `${label(e)}:${Math.round(heights[i])}`),
            };
        })
        .filter((g) => g.heightDiff > 1 || g.centreDiff > 1);
};

/** Heights of visible controls, counted per value. */
export const controlHeights = () => {
    const counts = {};
    for (const element of document.querySelectorAll(CONTROL_SELECTOR)) {
        if (!visible(element) || element.closest(".leaflet-container")) continue;
        const h = Math.round(element.getBoundingClientRect().height);
        counts[h] = (counts[h] ?? 0) + 1;
    }
    return counts;
};

/** The open dialog: is its last action inside the dialog and the viewport? */
export const dialog = () => {
    const d = document.querySelector("dialog[open]");
    if (!d) return null;
    const box = d.getBoundingClientRect();
    const buttons = [...d.querySelectorAll("button")].filter((b) => b.getBoundingClientRect().height > 0);
    const last = buttons[buttons.length - 1];
    const lastBox = last.getBoundingClientRect();
    const scroller = [d, ...d.querySelectorAll("*")].find(
        (e) => e.scrollHeight > e.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(e).overflowY),
    );
    return {
        title: d.querySelector("h2")?.textContent ?? null,
        width: Math.round(box.width),
        height: Math.round(box.height),
        lastAction: label(last),
        lastActionVisible: lastBox.bottom <= Math.min(box.bottom, innerHeight) + 0.5,
        scrolls: Boolean(scroller),
        controls: [...d.querySelectorAll(CONTROL_SELECTOR)]
            .filter((e) => e.getBoundingClientRect().height > 0)
            .map((e) => `${label(e)}:${Math.round(e.getBoundingClientRect().height)}`),
        focused: label(document.activeElement),
    };
};

/** Contrast of the focus indicator of `element` against what surrounds it. */
export const focusContrast = (element) => {
    element.focus();
    const style = getComputedStyle(element);
    const around = backgroundOf(element.parentElement ?? document.body);
    const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0
        ? parseColor(style.outlineColor)
        : null;
    const shadow = parseColor(style.boxShadow);
    const ring = outline ?? shadow;
    if (!ring) return { element: label(element), ratio: null };
    return {
        element: label(element),
        kind: outline ? `outline ${style.outlineWidth}` : "box-shadow",
        ratio: Number(contrastRatio(blend(ring, around), around).toFixed(2)),
    };
};

/** Layout shifts recorded while `action` runs, including those after input. */
export const shiftsDuring = async (action, settleMs = 800) => {
    const entries = [];
    const observer = new PerformanceObserver((list) => entries.push(...list.getEntries()));
    observer.observe({ type: "layout-shift" });
    await action();
    await new Promise((r) => setTimeout(r, settleMs));
    observer.disconnect();
    return entries.map((e) => ({
        value: Number(e.value.toFixed(4)),
        afterInput: e.hadRecentInput,
        sources: (e.sources ?? []).map((s) => String(s.node?.className || s.node?.nodeName || "?").slice(0, 40)),
    }));
};

/** Load CLS of the current document so far (entries without recent input). */
export const loadCls = () =>
    new Promise((resolve) => {
        const entries = [];
        const observer = new PerformanceObserver((list) => entries.push(...list.getEntries()));
        observer.observe({ type: "layout-shift", buffered: true });
        setTimeout(() => {
            observer.disconnect();
            const value = entries.filter((e) => !e.hadRecentInput).reduce((sum, e) => sum + e.value, 0);
            resolve(Number(value.toFixed(4)));
        }, 300);
    });

export const page = () => {
    const main = document.querySelector("main");
    const h1 = main?.querySelector("h1");
    return {
        path: location.pathname + location.hash,
        viewport: `${innerWidth}x${innerHeight}`,
        horizontalScroll: document.documentElement.scrollWidth > innerWidth + 1,
        mainScroll: main ? `${main.clientHeight}/${main.scrollHeight}` : null,
        h1: h1 ? getComputedStyle(h1).fontSize : null,
    };
};

const go = async (path, waitMs) => {
    history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
    await new Promise((r) => setTimeout(r, waitMs));
};

/** Client-side navigation through `paths`, one report per page. */
export const sweep = async (paths, { waitMs = 2600, contrast = true } = {}) => {
    const out = [];
    for (const path of paths) {
        await go(path, waitMs);
        out.push({
            ...page(),
            heights: controlHeights(),
            misaligned: alignment(),
            lowContrast: contrast ? textContrast() : undefined,
        });
    }
    return out;
};

const api = {
    alignment,
    backgroundOf,
    contrastRatio,
    controlHeights,
    dialog,
    focusContrast,
    loadCls,
    page,
    shiftsDuring,
    sweep,
    textContrast,
};

window.uiMeasure = api;
export default api;
