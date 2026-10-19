import { describe, expect, it } from "vitest";

import { yCeiling } from "../components/briefing/briefingChartSeries";

describe("yCeiling", () => {
    it("adds 15 % headroom and rounds up to the step", () => {
        expect(yCeiling([10], 8, 5)).toBe(15);
        expect(yCeiling([2.4], 3, 1)).toBe(4);
    });

    it("keeps a share axis at 100 % when the peak is close to it", () => {
        expect(yCeiling([96], 20, 5)).toBe(115);
        expect(yCeiling([96], 20, 5, 100)).toBe(100);
    });
});
