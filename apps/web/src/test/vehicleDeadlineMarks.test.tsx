import { render, screen } from "@testing-library/react";
import { addIsoDays, berlinTodayIso, type Vehicle } from "@fleet-live/shared";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { vehicleColumns } from "../components/vehicles/vehicleTableConfig";
import type { TableColumn } from "../types/table";

const row = (overrides: Partial<Vehicle> = {}): Vehicle =>
    ({
        id: 1,
        license_plate: "K-FR 1",
        hu_due_on: "2099-01",
        uvv_checked_on: null,
        uvv_due_on: "2099-01-01",
        open_alert_types: [],
        speeding_open: false,
        availability: "READY",
        workshop: null,
        workshop_task: null,
        open_damages: 0,
        hu_state: "ok",
        uvv_state: "ok",
        ...overrides,
    }) as Vehicle;

const cell = (key: keyof Vehicle, vehicle: Vehicle) => {
    const column = vehicleColumns.find((entry) => entry.key === key) as TableColumn<Vehicle> & {
        render: (value: unknown, context: { row: Vehicle }) => ReactNode;
    };
    return render(<div>{column.render(vehicle[key], { row: vehicle, isSelected: false, isEditing: false, selectionMode: false } as never)}</div>);
};

describe("deadlines in the vehicle list", () => {
    it("marks a past HU in yellow and names it among the hints", () => {
        const vehicle = row({ hu_due_on: "2020-01", hu_state: "overdue" });

        const { unmount } = cell("hu_due_on", vehicle);
        const mark = screen.getByTitle("abgelaufen");
        expect(mark).toHaveTextContent("01/2020");
        expect(mark).toHaveAttribute("data-state", "overdue");
        unmount();

        cell("active_alerts", vehicle);
        expect(screen.getByText("HU abgelaufen")).toHaveAttribute("data-tone", "accent");
    });

    it("says „UVV heute“ for a UVV due today", () => {
        const today = berlinTodayIso();
        cell("active_alerts", row({ uvv_due_on: today, uvv_state: "soon" }));

        expect(screen.getByText("UVV heute")).toBeInTheDocument();
    });

    it("rings a date due within the lead and leaves the hints alone", () => {
        const vehicle = row({ uvv_due_on: addIsoDays(berlinTodayIso(), 10), uvv_state: "soon" });

        const { unmount } = cell("uvv_due_on", vehicle);
        expect(screen.getByTitle("bald fällig")).toHaveAttribute("data-state", "soon");
        unmount();

        cell("active_alerts", vehicle);
        expect(screen.queryByText(/UVV/)).not.toBeInTheDocument();
    });

    it("names the open stay instead when it takes care of the HU", () => {
        cell(
            "active_alerts",
            row({
                hu_due_on: "2020-01",
                hu_state: "overdue",
                workshop: {
                    id: 4,
                    state: "PLANNED",
                    reasons: ["HU"],
                    place: "Autohaus Weber",
                    workshop_id: 1,
                    planned_on: "2099-11-03",
                    planned_time: null,
                    expected_on: "2099-11-03",
                },
            }),
        );

        expect(screen.queryByText("HU abgelaufen")).not.toBeInTheDocument();
        expect(screen.getByText("Werkstatt")).toBeInTheDocument();
    });
});
