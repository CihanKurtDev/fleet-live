import { describe, expect, it } from "vitest";

import { canResolveByHand } from "../components/alerts/alertTableConfig";

describe("canResolveByHand", () => {
    it("lets a dispatcher close an open Tempo warning", () => {
        expect(canResolveByHand({ type: "SPEEDING", resolved_at: null })).toBe(true);
    });

    it("leaves Wenig Tank and Funk to their state: they close themselves", () => {
        expect(canResolveByHand({ type: "LOW_FUEL", resolved_at: null })).toBe(false);
        expect(canResolveByHand({ type: "OFFLINE", resolved_at: null })).toBe(false);
    });

    it("has nothing to close on a resolved warning", () => {
        expect(
            canResolveByHand({ type: "SPEEDING", resolved_at: "2026-10-01 10:00:00" }),
        ).toBe(false);
    });
});
