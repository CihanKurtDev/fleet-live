import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { TodayResponse, Vehicle } from "@fleet-live/shared";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TodayPanel } from "../components/briefing/TodayPanel";
import {
    VehiclesContext,
    type VehiclesContextValue,
} from "../context/vehiclesContext";
import { authUser, renderAuth } from "./renderAuth";

vi.mock("../api/today", () => ({ getToday: vi.fn() }));
vi.mock("../api/alerts", () => ({ resolveAlert: vi.fn() }));
vi.mock("../api/vehicles", () => ({ getVehicle: vi.fn() }));
vi.mock("../api/drivers", () => ({ getDriver: vi.fn() }));
vi.mock("../api/sites", () => ({
    listSites: vi.fn().mockResolvedValue({ data: [] }),
}));

import { resolveAlert } from "../api/alerts";
import { getToday } from "../api/today";
import { getVehicle } from "../api/vehicles";

const empty = {
    vehicle_id: null,
    driver_id: null,
    due_kind: null,
    due_on: null,
    alert_id: null,
    since: null,
    open_warnings: null,
    fuel_level: null,
};

const response: TodayResponse = {
    data: [
        {
            ...empty,
            kind: "deadline_overdue",
            key: "hu",
            vehicle_id: 1,
            subject: "K-HU 1",
            due_kind: "hu",
            due_on: "2020-01",
        },
        {
            ...empty,
            kind: "driver_talk",
            key: "talk",
            driver_id: 4,
            subject: "Tina Tempo",
            open_warnings: 6,
        },
        {
            ...empty,
            kind: "offline",
            key: "offline",
            vehicle_id: 2,
            subject: "K-FUNK 1",
            alert_id: 7,
            since: "2026-10-16 08:00:00",
        },
    ],
    meta: {
        counts: {
            deadline_overdue: 12,
            driver_talk: 1,
            offline: 3,
            low_fuel: 0,
            deadline_soon: 0,
        },
        total: 16,
        limit: 6,
        lead_days: 30,
    },
};

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

const renderPanel = (role: "dispatcher" | "viewer" = "dispatcher") =>
    renderAuth(
        <VehiclesContext.Provider value={vehicles}>
            <Routes>
                <Route path="/" element={<TodayPanel />} />
                <Route path="/vehicles/:id" element={<p>Fahrzeugseite</p>} />
            </Routes>
        </VehiclesContext.Provider>,
        { user: authUser({ role }), route: "/" },
    );

// jsdom has no layout: the list is measured with ResizeObserver.
vi.stubGlobal(
    "ResizeObserver",
    class {
        observe() {}
        unobserve() {}
        disconnect() {}
    },
);

// jsdom does not know showModal/close in every version.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
};

beforeEach(() => {
    vi.mocked(getToday).mockReset();
    vi.mocked(getToday).mockResolvedValue(response);
    vi.mocked(resolveAlert).mockReset();
    vi.mocked(resolveAlert).mockResolvedValue({} as never);
});

describe("Heute dran", () => {
    it("links every count to the list that shows exactly those rows", async () => {
        renderPanel();

        const overdue = await screen.findByRole("link", {
            name: /12\s*Fristen überfällig/,
        });
        expect(overdue).toHaveAttribute("href", "/fristen?state=overdue");
        expect(
            screen.getByRole("link", { name: /1\s*Gespräch führen/ }),
        ).toHaveAttribute("href", "/drivers?min_open_warnings=5");
        expect(
            screen.getByRole("link", { name: /3\s*Kein Signal/ }),
        ).toHaveAttribute("href", "/alerts?type=OFFLINE");
        // Kinds without tasks get no chip.
        expect(screen.queryByRole("link", { name: /Wenig Tank/ })).toBeNull();
        expect(screen.getByText(/von 16 offenen Aufgaben/)).toBeInTheDocument();
    });

    it("resolves a no-signal warning in the row and says so", async () => {
        renderPanel();

        const row = await screen.findByRole("link", { name: /K-FUNK 1/ });
        fireEvent.click(within(row).getByRole("button", { name: "Erledigen" }));

        await waitFor(() => expect(resolveAlert).toHaveBeenCalledWith(7));
        expect(
            await screen.findByText("Warnung für K-FUNK 1 erledigt."),
        ).toHaveAttribute("role", "status");
        // The row button does not open the vehicle.
        expect(screen.queryByText("Fahrzeugseite")).toBeNull();
    });

    it("opens the vehicle form on Schicht for a deadline", async () => {
        vi.mocked(getVehicle).mockResolvedValue({
            id: 1,
            license_plate: "K-HU 1",
            status: "IDLE",
            fuel_level: 50,
        } as Vehicle);
        renderPanel();

        const row = await screen.findByRole("link", { name: /K-HU 1/ });
        fireEvent.click(within(row).getByRole("button", { name: "Eintragen" }));

        await waitFor(() =>
            expect(getVehicle).toHaveBeenCalledWith(1, expect.anything()),
        );
        expect(
            await screen.findByRole("dialog", { name: "K-HU 1", hidden: true }),
        ).toBeInTheDocument();
    });

    it("keeps Enter on a row button for the button", async () => {
        renderPanel();

        const row = await screen.findByRole("link", { name: /K-FUNK 1/ });
        fireEvent.keyDown(within(row).getByRole("button", { name: "Erledigen" }), {
            key: "Enter",
        });

        expect(screen.queryByText("Fahrzeugseite")).toBeNull();

        // Enter on the row itself still opens the record.
        fireEvent.keyDown(row, { key: "Enter" });
        expect(await screen.findByText("Fahrzeugseite")).toBeInTheDocument();
    });

    it("opens the record on a row click", async () => {
        renderPanel();

        fireEvent.click(await screen.findByRole("link", { name: /K-HU 1/ }));

        expect(await screen.findByText("Fahrzeugseite")).toBeInTheDocument();
    });

    it("shows a viewer the list without actions", async () => {
        renderPanel("viewer");

        await screen.findByRole("link", { name: /K-HU 1/ });
        expect(screen.queryByRole("button", { name: "Eintragen" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Erledigen" })).toBeNull();
    });
});
