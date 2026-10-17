import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { Alert, AlertListResponse, Vehicle } from "@fleet-live/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VehicleHintsPanel } from "../components/alerts/VehicleHintsPanel";
import {
    VehiclesContext,
    type VehiclesContextValue,
} from "../context/vehiclesContext";
import { renderAuth } from "./renderAuth";

vi.mock("../api/alerts", () => ({
    listAlerts: vi.fn(),
    resolveAlert: vi.fn(),
}));

import { listAlerts, resolveAlert } from "../api/alerts";

const vehicle: Vehicle = {
    id: 3,
    license_plate: "K-FUNK 3",
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
    active_alerts: 1,
    speeding_open: false,
    open_alert_types: ["OFFLINE"],
    created_at: "2026-10-01 08:00:00",
    current_driver_id: 7,
};

const offline = (overrides: Partial<Alert>): Alert => ({
    id: 9,
    vehicle_id: 3,
    driver_id: 7,
    license_plate: "K-FUNK 3",
    driver_name: "Lisa Müller",
    type: "OFFLINE",
    severity: "MEDIUM",
    message: "Kein Signal",
    details: null,
    created_at: "2026-10-16 12:54:00",
    ended_at: null,
    resolved_at: null,
    ...overrides,
});

const page = (data: Alert[]) =>
    ({
        data,
        meta: { page: 1, limit: 10, total: data.length, pageCount: 1 },
    }) as unknown as AlertListResponse;

const vehicles = {
    listEpoch: 0,
    vehicleOverrides: {},
    streamConnection: "live",
    lastTelemetryAt: null,
    refetchLists: vi.fn(),
    createVehicle: vi.fn(),
    updateVehicle: vi.fn(),
    deleteVehicles: vi.fn(),
    subscribeTripPath: vi.fn(() => () => undefined),
} satisfies VehiclesContextValue;

const renderHints = () =>
    renderAuth(
        <VehiclesContext.Provider value={vehicles}>
            <VehicleHintsPanel vehicle={vehicle} canWrite />
        </VehiclesContext.Provider>,
    );

beforeEach(() => {
    vi.mocked(listAlerts).mockReset();
    vi.mocked(resolveAlert).mockReset();
    vi.mocked(resolveAlert).mockResolvedValue({} as never);
});

describe("Hinweise: kein Signal", () => {
    it("says when the signal came back and still lets the warning be resolved", async () => {
        vi.mocked(listAlerts).mockResolvedValue(
            page([offline({ ended_at: "2026-10-16 17:20:00" })]),
        );
        renderHints();

        expect(
            await screen.findByText(/Kein Signal · beendet/),
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Erledigen" }));
        await waitFor(() => expect(resolveAlert).toHaveBeenCalledWith(9));
    });

    it("shows a running warning without an end", async () => {
        vi.mocked(listAlerts).mockResolvedValue(page([offline({})]));
        renderHints();

        expect(await screen.findByText("Kein Signal")).toBeInTheDocument();
        expect(screen.queryByText(/beendet/)).toBeNull();
    });
});
