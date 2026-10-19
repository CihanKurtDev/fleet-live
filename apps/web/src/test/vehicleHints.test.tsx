import { render, screen } from "@testing-library/react";
import type { Vehicle } from "@fleet-live/shared";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

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
    ...overrides,
});

const renderHints = (v: Vehicle, canWrite = true) =>
    render(
        <MemoryRouter>
            <VehicleHintsPanel vehicle={v} canWrite={canWrite} />
        </MemoryRouter>,
    );

describe("Hinweise: Kein Signal", () => {
    it("shows it while the vehicle has no signal, with a link to its warning and no button", () => {
        renderHints(
            vehicle({ status: "OFFLINE", open_alert_types: ["OFFLINE"], active_alerts: 1 }),
        );

        expect(screen.getByText("Meldet sich nicht.")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Zu den Warnungen" })).toHaveAttribute(
            "href",
            "/alerts?vehicle_id=3&type=OFFLINE",
        );
        // The warning closes itself when the vehicle reports again.
        expect(screen.queryByRole("button", { name: "Erledigen" })).toBeNull();
    });

    it("shows nothing when the vehicle reports", () => {
        renderHints(vehicle());

        expect(screen.getByText("Keine offenen Hinweise.")).toBeInTheDocument();
        expect(screen.queryByText("Meldet sich nicht.")).toBeNull();
    });

    it("shows low fuel next to it", () => {
        renderHints(
            vehicle({ status: "OFFLINE", open_alert_types: ["OFFLINE"], fuel_level: 4 }),
        );

        expect(screen.getByText("Meldet sich nicht.")).toBeInTheDocument();
        expect(screen.getByText(/Tank bei 4 %/)).toBeInTheDocument();
    });
});
