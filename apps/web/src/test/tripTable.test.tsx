import type { TripListItem } from "@fleet-live/shared";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { tripColumns } from "../components/vehicles/tripTableConfig";
import { Table } from "../components/ui/Table/Table";

const row = (overrides: Partial<TripListItem>): TripListItem => ({
    id: 1,
    vehicle_id: 1,
    started_at: "2026-10-20 08:00:00",
    ended_at: "2026-10-20 09:00:00",
    point_count: 10,
    distance_m: 40_000,
    max_speed: 92,
    driver_id: 5,
    driver_name: "Erika Muster",
    speeding_count: 0,
    offline_count: 0,
    ...overrides,
});

describe("trip list", () => {
    it("shows who drove and what went wrong on each trip", () => {
        render(
            <Table
                columns={tripColumns}
                rows={[
                    row({ id: 1, speeding_count: 2, offline_count: 1 }),
                    row({ id: 2, driver_id: null, driver_name: null, max_speed: 48 }),
                ]}
                getRowKey={(trip) => trip.id}
                caption="Fahrten"
            />,
        );

        const [first, second] = screen.getAllByRole("row").slice(1);

        expect(within(first!).getByText("Erika Muster")).toBeInTheDocument();
        expect(within(first!).getByText("2× Tempo")).toBeInTheDocument();
        expect(within(first!).getByText("Kein Signal")).toBeInTheDocument();
        expect(within(second!).getByText("nicht erfasst")).toBeInTheDocument();
        expect(within(second!).getByText("keine")).toBeInTheDocument();
    });
});
