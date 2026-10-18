import { describe, expect, it } from "vitest";

import { markerStyle } from "../components/vehicles/fleetMapStyle";

describe("markerStyle", () => {
    it("draws a plain dot small with a faint outline", () => {
        const plain = markerStyle("DRIVING", false);

        expect(plain.radius).toBe(4);
        expect(plain.weight).toBe(1);
        expect(plain.opacity).toBeLessThan(1);
    });

    it("marks the members of an opened group with a ring, bigger than a plain dot", () => {
        const plain = markerStyle("DRIVING", false);
        const grouped = markerStyle("DRIVING", false, true);

        expect(grouped.radius).toBeGreaterThan(plain.radius);
        expect(grouped.weight).toBeGreaterThan(plain.weight);
        expect(grouped.opacity).toBe(1);
        expect(grouped.color).not.toBe(plain.color);
    });

    it("keeps the selected vehicle stronger than a group member", () => {
        const grouped = markerStyle("DRIVING", false, true);
        const selected = markerStyle("DRIVING", true, true);

        expect(selected.radius).toBeGreaterThan(grouped.radius);
        expect(selected.weight).toBeGreaterThan(grouped.weight);
    });

    it("keeps the status colour in every state", () => {
        const fill = markerStyle("DRIVING", false).fillColor;

        expect(markerStyle("DRIVING", false, true).fillColor).toBe(fill);
        expect(markerStyle("DRIVING", true, true).fillColor).toBe(fill);
        expect(markerStyle("OFFLINE", false, true).fillColor).not.toBe(fill);
    });
});
