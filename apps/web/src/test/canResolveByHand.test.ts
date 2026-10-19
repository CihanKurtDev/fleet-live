import { describe, expect, it } from "vitest";

import { canResolveByHand } from "../components/alerts/alertTableConfig";

describe("canResolveByHand", () => {
    it("lets a dispatcher close open Tempo and Funk warnings", () => {
        expect(canResolveByHand({ type: "SPEEDING", resolved_at: null })).toBe(true);
        expect(canResolveByHand({ type: "OFFLINE", resolved_at: null })).toBe(true);
    });

    it("leaves the tank warning to the tank: it closes itself when filled", () => {
        expect(canResolveByHand({ type: "LOW_FUEL", resolved_at: null })).toBe(false);
    });

    it("has nothing to close on a resolved warning", () => {
        expect(
            canResolveByHand({ type: "SPEEDING", resolved_at: "2026-10-01 10:00:00" }),
        ).toBe(false);
    });
});
