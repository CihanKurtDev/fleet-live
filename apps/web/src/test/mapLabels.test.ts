import { describe, expect, it } from "vitest";
import {
    depotLabelHtml,
    detailTooltipHtml,
    fleetTooltipHtml,
} from "../components/vehicles/mapLabels";

const hostile = `<img src=x onerror="alert('x')">&`;

/** What a browser shows for the HTML Leaflet writes into the tooltip. */
const rendered = (html: string) => {
    const box = document.createElement("div");
    box.innerHTML = html;
    return { text: box.textContent, elements: box.querySelectorAll("*").length };
};

describe("map labels", () => {
    it("show a plate and a driver name as text, never as markup", () => {
        const html = fleetTooltipHtml({
            license_plate: hostile,
            driver_name: hostile,
            status: "DRIVING",
        });

        expect(rendered(html)).toEqual({
            text: `${hostile} · ${hostile} · Auf Fahrt`,
            elements: 0,
        });
    });

    it("name a vehicle without a driver", () => {
        expect(
            rendered(fleetTooltipHtml({ license_plate: "K-AB 1", driver_name: null, status: "IDLE" }))
                .text,
        ).toBe("K-AB 1 · Kein Fahrer · Standby");
    });

    it("show the detail label and a depot name as text", () => {
        expect(rendered(detailTooltipHtml(hostile, "OFFLINE"))).toEqual({
            text: `${hostile} · Kein Signal`,
            elements: 0,
        });
        expect(rendered(depotLabelHtml(hostile))).toEqual({ text: hostile, elements: 0 });
    });
});
