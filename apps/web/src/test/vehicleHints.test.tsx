import { fireEvent, render, screen } from "@testing-library/react";
import type { Vehicle } from "@fleet-live/shared";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("../context/vehiclesContext", () => ({
    useVehicles: () => ({ listEpoch: 0 }),
}));

vi.mock("../hooks/useDueSettings", () => ({
    useDueSettings: () => ({ settings: { lead_days: 30, check_months: 6 } }),
}));

vi.mock("../api/alerts", () => ({
    listAlerts: vi.fn().mockResolvedValue({
        data: [{ id: 41, created_at: "2026-10-27 13:24:01" }],
        meta: { total: 1 },
    }),
}));

vi.mock("../api/drivers", () => ({
    getDriver: vi.fn().mockResolvedValue({ id: 7, phone: "+49 170 6152496" }),
}));

import { VehicleHintsPanel } from "../components/alerts/VehicleHintsPanel";

const vehicle = (overrides: Partial<Vehicle> = {}): Vehicle => ({
    id: 3,
    license_plate: "K-SIG 3",
    driver_name: "Lisa Müller",
    fuel_level: 60,
    status: "DRIVING",
    vin: null,
    vehicle_type: "VAN",
    hu_due_on: "2030-01",
    uvv_checked_on: "2026-09-01",
    uvv_due_on: null,
    active: true,
    depot: null,
    home_site_id: null,
    cost_center: null,
    odometer_km: null,
    odometer_reported_at: null,
    latitude: 50.9,
    longitude: 6.9,
    speed: 80,
    speed_limit_kmh: 120,
    recorded_at: "2026-10-17 09:00:00",
    active_alerts: 0,
    speeding_open: false,
    open_alert_types: [],
    created_at: "2026-10-01 08:00:00",
    current_driver_id: 7,
    availability: "READY",
    workshop: null,
    workshop_task: null,
    open_damages: 0,
    hu_state: "ok",
    uvv_state: "ok",
    ...overrides,
});

const renderHints = (v: Vehicle, canWrite = true) =>
    render(
        <MemoryRouter>
            <VehicleHintsPanel vehicle={v} canWrite={canWrite} />
        </MemoryRouter>,
    );

describe("Hinweise: Kein Signal", () => {
    it("shows how long the vehicle is silent and whom to call, and no button", async () => {
        renderHints(
            vehicle({ status: "OFFLINE", open_alert_types: ["OFFLINE"], active_alerts: 1 }),
        );

        expect(await screen.findByText(/^Meldet sich nicht seit \d+ Tag/)).toBeInTheDocument();
        expect(screen.getByText("Fahrer anrufen: +49 170 6152496")).toBeInTheDocument();
        // The warning closes itself when the vehicle reports again.
        expect(screen.queryByRole("button", { name: "Erledigen" })).toBeNull();
    });

    it("shows nothing when the vehicle reports", () => {
        renderHints(vehicle());

        expect(screen.getByText("Keine offenen Hinweise.")).toBeInTheDocument();
        expect(screen.queryByText(/Meldet sich nicht/)).toBeNull();
    });

    it("shows low fuel next to it", async () => {
        renderHints(
            vehicle({ status: "OFFLINE", open_alert_types: ["OFFLINE"], fuel_level: 4 }),
        );

        expect(await screen.findByText(/^Meldet sich nicht/)).toBeInTheDocument();
        expect(screen.getByText(/Tank bei 4 %/)).toBeInTheDocument();
    });
});

describe("Hinweise: HU und UVV", () => {
    const renderDue = (v: Vehicle) => {
        const onPlan = vi.fn();
        const onEditMaster = vi.fn();
        render(
            <MemoryRouter>
                <VehicleHintsPanel vehicle={v} canWrite onPlanWorkshop={onPlan} onEditMaster={onEditMaster} />
            </MemoryRouter>,
        );
        return { onPlan, onEditMaster };
    };

    it("plans a workshop stay for an overdue HU and asks for a missing date", () => {
        const { onPlan, onEditMaster } = renderDue(vehicle({ hu_due_on: "2020-01", uvv_checked_on: null }));

        fireEvent.click(screen.getByRole("button", { name: "Termin planen" }));
        expect(onPlan).toHaveBeenCalledWith({ reason: "HU" });

        fireEvent.click(screen.getByRole("button", { name: "Eintragen" }));
        expect(onEditMaster).toHaveBeenCalledWith("uvv-checked");
    });

    it("names the open stay instead of planning a second one", () => {
        renderDue(
            vehicle({
                hu_due_on: "2020-01",
                workshop: {
                    id: 4,
                    state: "PLANNED",
                    reasons: ["HU"],
                    place: "Autohaus Weber",
                    workshop_id: 1,
                    planned_on: "2026-11-03",
                    planned_time: null,
                    expected_on: "2026-11-03",
                },
            }),
        );

        expect(screen.getByText(/Termin am 03\.11\.2026/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Termin planen" })).toBeNull();
    });
});
