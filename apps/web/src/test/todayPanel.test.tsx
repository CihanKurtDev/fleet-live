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
vi.mock("../api/vehicles", () => ({ getVehicle: vi.fn() }));
vi.mock("../api/drivers", () => ({ getDriver: vi.fn() }));
vi.mock("../api/sites", () => ({
    listSites: vi.fn().mockResolvedValue({ data: [] }),
}));

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
    workshop: null,
    damage: null,
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
            workshop_due: 0,
            damage_unplanned: 0,
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
});

describe("Heute dran", () => {
    it("links every count to the list that shows exactly those rows", async () => {
        renderPanel();

        expect(
            await screen.findByRole("link", { name: /1s*Gespräch führen/ }),
        ).toHaveAttribute("href", "/drivers?min_open_warnings=5");
        expect(screen.getByText(/von 16 offenen Aufgaben/)).toBeInTheDocument();
    });

    it("has no chip for a number a tile on the page already shows", async () => {
        vi.mocked(getToday).mockResolvedValue({
            ...response,
            meta: {
                ...response.meta,
                counts: { ...response.meta.counts, low_fuel: 392 },
            },
        });
        renderPanel();

        await screen.findByRole("link", { name: /1s*Gespräch führen/ });
        expect(screen.queryByRole("link", { name: /Fristen überfällig/ })).toBeNull();
        expect(screen.queryByRole("link", { name: /Kein Signal/ })).toBeNull();
        expect(screen.queryByRole("link", { name: /392s*Wenig Tank/ })).toBeNull();
    });

    it("lists a no-signal task with no button: the warning closes itself", async () => {
        renderPanel();

        const row = await screen.findByRole("link", { name: /K-FUNK 1/ });
        expect(within(row).queryByRole("button")).toBeNull();
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

        const row = await screen.findByRole("link", { name: /K-HU 1/ });
        fireEvent.keyDown(within(row).getByRole("button", { name: "Eintragen" }), {
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
    });
});

describe("Heute dran in an empty company", () => {
    const nothing: TodayResponse = {
        data: [],
        meta: {
            ...response.meta,
            counts: {
                deadline_overdue: 0,
                driver_talk: 0,
                offline: 0,
                low_fuel: 0,
                deadline_soon: 0,
                workshop_due: 0,
                damage_unplanned: 0,
            },
            total: 0,
        },
    };

    it("says where tasks will come from, not that the shift is calm", async () => {
        vi.mocked(getToday).mockResolvedValue(nothing);
        renderAuth(
            <VehiclesContext.Provider value={vehicles}>
                <TodayPanel companyEmpty />
            </VehiclesContext.Provider>,
            { user: authUser(), route: "/" },
        );

        expect(await screen.findByText("Noch keine Aufgaben")).toBeInTheDocument();
        expect(screen.queryByText("Nichts offen. Gute Schicht.")).toBeNull();
    });

    it("keeps the calm line once the company has vehicles", async () => {
        vi.mocked(getToday).mockResolvedValue(nothing);
        renderPanel();

        expect(
            await screen.findByText("Nichts offen. Gute Schicht."),
        ).toBeInTheDocument();
    });
});

describe("Heute dran: workshop stays", () => {
    const stay = {
        id: 4,
        vehicle_id: 5,
        license_plate: "K-RT 4410",
        hu_due_on: "2027-03",
        reason: "MAINTENANCE" as const,
        state: "IN_WORKSHOP" as const,
        place: "Werkstatt Becker",
        planned_on: "2026-10-20",
        expected_on: "2026-10-27",
        assignee_user_id: 1,
        assignee_name: "Cihan Kurt",
        note: null,
        arrived_on: "2026-10-20",
        finished_on: null,
        cost_cents: null,
        result_note: null,
        created_at: "2026-10-19 10:00:00",
    };
    const late: TodayResponse = {
        data: [
            {
                ...empty,
                kind: "workshop_due",
                key: "workshop_due:4",
                vehicle_id: 5,
                subject: "K-RT 4410",
                workshop: stay,
                damage: null,
            },
        ],
        meta: {
            ...response.meta,
            counts: {
                deadline_overdue: 0,
                driver_talk: 0,
                offline: 0,
                low_fuel: 0,
                deadline_soon: 0,
                workshop_due: 1,
                damage_unplanned: 0,
            },
            total: 1,
        },
    };

    it("marks a late return, says who is on it and offers Fertig melden", async () => {
        vi.mocked(getToday).mockResolvedValue(late);
        renderPanel();

        const row = await screen.findByRole("link", { name: /K-RT 4410/ });
        expect(within(row).getByText("Rückgabe")).toBeInTheDocument();
        expect(
            within(row).getByText(
                "Wartung bei Werkstatt Becker · fertig erwartet am 27.10.2026 · zuständig: du",
            ),
        ).toBeInTheDocument();
        expect(within(row).getByRole("button", { name: "Fertig melden" })).toBeInTheDocument();

        const chip = screen.getByRole("link", { name: /Werkstatt fällig/ });
        expect(chip).toHaveAttribute("href", "/vehicles?filter=workshop_due");
    });
});
