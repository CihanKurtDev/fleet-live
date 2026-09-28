import { describe, expect, it } from "vitest";
import {
    serializeFleetPositionsQuery,
    serializeVehicleListQuery,
} from "@fleet-live/shared";

describe("query serialization", () => {
    it("serializes list state without redundant defaults", () => {
        const params = serializeVehicleListQuery({
            search: "K-AB",
            filter: "driving",
            dir: "asc",
            page: 1,
            limit: 10,
        });

        expect(params.toString()).toBe("search=K-AB&filter=driving");
    });

    it("preserves fleet bounds and repeated driver filters", () => {
        const params = serializeFleetPositionsQuery({
            bbox: { west: 6.8, south: 50.8, east: 7.2, north: 51.1 },
            drivers: ["Anna Müller", "Max Müller"],
        });

        expect(params.get("bbox")).toBe("6.8,50.8,7.2,51.1");
        expect(params.getAll("drivers")).toEqual([
            "Anna Müller",
            "Max Müller",
        ]);
    });
});
