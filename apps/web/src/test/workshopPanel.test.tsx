import { fireEvent, screen, waitFor } from "@testing-library/react";
import {
    berlinTodayIso,
    type Vehicle,
    type VehicleWorkshop,
    type WorkshopPlace,
    type WorkshopVisit,
} from "@fleet-live/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkshopPanel } from "../components/vehicles/WorkshopPanel";
import { VehiclesContext, type VehiclesContextValue } from "../context/vehiclesContext";
import { authUser, renderAuth } from "./renderAuth";

vi.mock("../api/workshop", () => ({
    getVehicleWorkshop: vi.fn(),
    arriveWorkshopVisit: vi.fn(),
    cancelWorkshopVisit: vi.fn(),
    createWorkshopVisit: vi.fn(),
    updateWorkshopVisit: vi.fn(),
    finishWorkshopVisit: vi.fn(),
    getWorkshopPlaces: vi.fn(),
    addWorkshopCost: vi.fn(),
    getWorkshopBringers: vi.fn().mockResolvedValue({
        data: [
            {
                id: 7,
                name: "Lisa Müller",
                licence_expires_on: null,
                licence_expired: false,
                is_current: true,
                driving_plate: null,
                other_transports: [],
            },
        ],
    }),
}));

vi.mock("../api/auth", () => ({
    listMembers: vi.fn(),
}));

vi.mock("../api/drivers", () => ({
    listDrivers: vi.fn().mockResolvedValue({ data: [] }),
    setDriverCurrentVehicle: vi.fn(),
}));

vi.mock("../api/damages", () => ({
    listVehicleDamages: vi.fn().mockResolvedValue({ data: [] }),
}));

vi.mock("../api/odometer", () => ({
    getVehicleOdometer: vi.fn().mockRejectedValue(new Error("offline")),
}));

vi.mock("../api/sim", () => ({
    listSimRoutes: vi.fn().mockResolvedValue({ data: [] }),
}));

import { listMembers } from "../api/auth";
import { getVehicleOdometer } from "../api/odometer";
import { createWorkshopVisit, finishWorkshopVisit, getVehicleWorkshop, getWorkshopPlaces } from "../api/workshop";

const today = berlinTodayIso();
const shift = (days: number) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
};

const contextValue = {
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

const vehicle = (overrides: Partial<Vehicle> = {}) =>
    ({
        id: 9,
        license_plate: "K-CV 9419",
        driver_name: "Marco Schröder",
        current_driver_id: 7,
        status: "DRIVING",
        latitude: 50.98,
        longitude: 6.97,
        availability: "READY",
        workshop: null,
        ...overrides,
    }) as unknown as Vehicle;

const place: WorkshopPlace = {
    id: 3,
    name: "Karosserie Schmitz",
    address: "Industriestraße 12, 50735 Köln",
    phone: "0221 555 0142",
    latitude: 50.99,
    longitude: 6.98,
    radius_m: 150,
    vehicles_here: 0,
    here: [],
    appointments: [],
};

const visit = (overrides: Partial<WorkshopVisit> = {}): WorkshopVisit => ({
    id: 4,
    vehicle_id: 9,
    license_plate: "K-CV 9419",
    hu_due_on: "2026-02",
    reasons: ["HU"],
    transport: "DRIVER",
    state: "PLANNED",
    place: "Karosserie Schmitz",
    workshop_id: 3,
    planned_on: today,
    planned_time: "08:00",
    expected_on: shift(1),
    bring_driver_id: 7,
    bring_driver_name: "Marco Schröder",
    assignee_user_id: 1,
    assignee_name: "Cihan Kurt",
    note: null,
    workshop: { ...place },
    arrived_on: null,
    arrived_at: null,
    arrived_by: null,
    finished_on: null,
    picked_up_at: null,
    cost_cents: null,
    result_note: null,
    created_at: "2026-10-27 15:40:00",
    ...overrides,
});

const workshop = (overrides: Partial<VehicleWorkshop> = {}): VehicleWorkshop => ({
    open: null,
    events: [],
    past: [],
    here: null,
    to_pick_up: null,
    ...overrides,
});

const renderPanel = (role: "dispatcher" | "viewer" = "dispatcher", target = vehicle()) => {
    const onNotice = vi.fn();
    renderAuth(
        <VehiclesContext.Provider value={contextValue}>
            <section>
                <WorkshopPanel vehicle={target} canWrite={role === "dispatcher"} onNotice={onNotice} />
            </section>
        </VehiclesContext.Provider>,
        { user: authUser({ role }) },
    );
    return { onNotice };
};

beforeEach(() => {
    vi.mocked(listMembers).mockResolvedValue({
        data: [
            { user_id: 1, name: "Cihan Kurt", email: "c@example.com", role: "dispatcher", invited: false },
            { user_id: 2, name: "Lea Brandt", email: "l@example.com", role: "dispatcher", invited: false },
        ],
    });
    vi.mocked(getWorkshopPlaces).mockResolvedValue({ data: [place] });
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
        this.removeAttribute("open");
    };
});

describe("WorkshopPanel", () => {
    it("says a driving vehicle with an appointment arrives by its position; no Angekommen button", async () => {
        vi.mocked(getVehicleWorkshop).mockResolvedValue({ data: workshop({ open: visit() }) });
        renderPanel();

        expect(await screen.findByText("Fährt gerade.")).toBeInTheDocument();
        expect(screen.getByText("Gilt als angekommen, sobald es dort parkt.")).toBeInTheDocument();
        expect(screen.getByText("heute, 08:00")).toBeInTheDocument();
        expect(screen.getByText("0221 555 0142")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Angekommen/ })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Absagen" })).toBeInTheDocument();
    });

    it("marks a missed appointment and offers Neu planen", async () => {
        vi.mocked(getVehicleWorkshop).mockResolvedValue({
            data: workshop({ open: visit({ planned_on: shift(-2), expected_on: shift(-1) }) }),
        });
        renderPanel("dispatcher", vehicle({ status: "IDLE", current_driver_id: null }));

        expect(await screen.findByText("Verpasst")).toBeInTheDocument();
        expect(screen.getByText("Das Fahrzeug war nicht dort.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Neu planen" })).toBeInTheDocument();
    });

    it("shows how the arrival was seen and finishes an HU only with the new month", async () => {
        const there = visit({
            state: "IN_WORKSHOP",
            arrived_on: today,
            arrived_at: `${today} 07:06:00`,
            arrived_by: "POSITION",
        });
        vi.mocked(getVehicleWorkshop).mockResolvedValue({ data: workshop({ open: there }) });
        vi.mocked(finishWorkshopVisit).mockResolvedValue({ data: { ...there, state: "DONE" } });
        renderPanel("dispatcher", vehicle({ status: "IDLE", current_driver_id: null }));

        expect(await screen.findByText("Erkannt an der Position.")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Fertig melden" }));
        await screen.findByRole("dialog", { name: "Fertig melden" });
        fireEvent.click(screen.getAllByRole("button", { name: "Fertig melden" }).at(-1)!);
        expect(await screen.findByText("Neue HU fällig fehlt.")).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText("Neue HU fällig"), { target: { value: "2028-10" } });
        fireEvent.click(screen.getAllByRole("button", { name: "Fertig melden" }).at(-1)!);
        await waitFor(() =>
            expect(finishWorkshopVisit).toHaveBeenCalledWith(4, {
                finished_on: today,
                cost: "",
                result_note: "",
                hu_due_on: "2028-10",
            }),
        );
    });

    it("takes the reading on the invoice for a GPS box when it is finished", async () => {
        const there = visit({ state: "IN_WORKSHOP", reasons: ["MAINTENANCE"], arrived_on: today, arrived_at: `${today} 07:06:00` });
        vi.mocked(getVehicleWorkshop).mockResolvedValue({ data: workshop({ open: there }) });
        vi.mocked(getVehicleOdometer).mockResolvedValueOnce({ data: { km: 52310, reported_at: null, readings: [] } });
        vi.mocked(finishWorkshopVisit).mockResolvedValue({ data: { ...there, state: "DONE" } });
        renderPanel("dispatcher", vehicle({ status: "IDLE", current_driver_id: null }));

        fireEvent.click(await screen.findByRole("button", { name: "Fertig melden" }));
        const field = await screen.findByLabelText("Kilometerstand laut Rechnung");
        expect(screen.getByText(/jetzt ≈ 52.310 km/)).toBeInTheDocument();
        fireEvent.change(field, { target: { value: "52.480" } });
        fireEvent.click(screen.getAllByRole("button", { name: "Fertig melden" }).at(-1)!);

        await waitFor(() =>
            expect(finishWorkshopVisit).toHaveBeenCalledWith(4, {
                finished_on: today,
                cost: "",
                result_note: "",
                hu_due_on: null,
                odometer: "52.480",
            }),
        );
    });

    it("asks for a driver to pick up a finished vehicle that still stands there", async () => {
        const done = visit({ state: "DONE", finished_on: today, arrived_at: `${today} 07:06:00` });
        vi.mocked(getVehicleWorkshop).mockResolvedValue({
            data: workshop({ past: [done], to_pick_up: done, here: { id: 3, name: "Karosserie Schmitz", phone: null } }),
        });
        renderPanel("dispatcher", vehicle({ status: "IDLE", current_driver_id: null, driver_name: null }));

        expect(await screen.findByText("Kein Fahrer zum Abholen.")).toBeInTheDocument();
        expect(screen.getByText("noch offen")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Fahrer zuweisen" }));
        expect(await screen.findByRole("dialog", { name: "Fahrer zuweisen" })).toHaveTextContent(
            "holt es bei Karosserie Schmitz ab",
        );
    });

    it("plans a stay at a workshop from the list, no free text", async () => {
        vi.mocked(getVehicleWorkshop).mockResolvedValue({ data: workshop() });
        vi.mocked(createWorkshopVisit).mockResolvedValue({ data: visit() });
        const { onNotice } = renderPanel("dispatcher", vehicle({ status: "IDLE" }));

        fireEvent.click(await screen.findByRole("button", { name: "In die Werkstatt" }));
        await screen.findByRole("dialog", { name: "In die Werkstatt" });
        fireEvent.click(screen.getByLabelText("HU"));
        await screen.findByRole("option", { name: /Karosserie Schmitz · / });
        fireEvent.change(screen.getByRole("combobox", { name: "Werkstatt" }), { target: { value: "3" } });
        expect(screen.getByText("Industriestraße 12, 50735 Köln · 0221 555 0142")).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText("Termin am"), { target: { value: shift(3) } });
        expect(screen.getByLabelText("Fertig erwartet")).toHaveValue(shift(3));
        fireEvent.change(screen.getByLabelText("Uhrzeit"), { target: { value: "08:00" } });
        fireEvent.click(screen.getByRole("button", { name: "Termin planen" }));

        await waitFor(() =>
            expect(createWorkshopVisit).toHaveBeenCalledWith(9, {
                reasons: ["HU"],
                transport: "DRIVER",
                workshop_id: 3,
                planned_on: shift(3),
                planned_time: "08:00",
                expected_on: shift(3),
                bring_driver_id: 7,
                assignee_user_id: 1,
                note: null,
                arrived: false,
                damage_ids: [],
            }),
        );
        expect(onNotice).toHaveBeenLastCalledWith({
            text: `Termin für K-CV 9419 am ${shift(3).slice(8, 10)}.${shift(3).slice(5, 7)}. um 08:00 bei Karosserie Schmitz geplant.`,
            tone: "ok",
        });
    });

    it("suggests the nearest workshop and asks back when the chosen one is far away", async () => {
        const budapest: WorkshopPlace = { ...place, id: 5, name: "Budapest", address: null, phone: null, latitude: 47.4979, longitude: 19.0402 };
        vi.mocked(getVehicleWorkshop).mockResolvedValue({ data: workshop() });
        vi.mocked(getWorkshopPlaces).mockResolvedValue({ data: [budapest, place] });
        renderPanel("dispatcher", vehicle({ status: "IDLE" }));

        fireEvent.click(await screen.findByRole("button", { name: "In die Werkstatt" }));
        await screen.findByRole("option", { name: /Budapest · / });
        // Without a home depot the distance is measured from the last position, and says so.
        expect(screen.getByText(/Am nächsten:/)).toHaveTextContent("Karosserie Schmitz · 1,3 km vom letzten Standort");

        const select = screen.getByRole("combobox", { name: "Werkstatt" });
        fireEvent.change(select, { target: { value: "5" } });
        expect(screen.getByRole("status")).toHaveTextContent(/Luftlinie vom letzten Standort\. Näher liegt Karosserie Schmitz · 1,3 km/);
        fireEvent.click(screen.getByRole("button", { name: "Karosserie Schmitz nehmen" }));
        expect(select).toHaveValue("3");
        expect(screen.queryByText(/Luftlinie/)).not.toBeInTheDocument();
    });

    it("asks for a workshop nearby when none is nearer than the far one", async () => {
        const budapest: WorkshopPlace = { ...place, id: 5, name: "Budapest", address: null, phone: null, latitude: 47.4979, longitude: 19.0402 };
        vi.mocked(getVehicleWorkshop).mockResolvedValue({ data: workshop() });
        vi.mocked(getWorkshopPlaces).mockResolvedValue({ data: [budapest] });
        renderPanel("dispatcher", vehicle({ status: "IDLE" }));

        fireEvent.click(await screen.findByRole("button", { name: "In die Werkstatt" }));
        await screen.findByRole("option", { name: /Budapest · / });
        // Nothing nearby: no suggestion to take the far one.
        expect(screen.getByText(/Keine Werkstatt näher als 50 km vom letzten Standort; die nächste ist/)).toHaveTextContent("Budapest");
        expect(screen.queryByRole("button", { name: "Übernehmen" })).not.toBeInTheDocument();
        fireEvent.change(screen.getByRole("combobox", { name: "Werkstatt" }), { target: { value: "5" } });
        expect(screen.getByRole("status")).toHaveTextContent("Gibt es keine Werkstatt in der Nähe?");
        expect(screen.getAllByRole("button", { name: "Neue Werkstatt" })).toHaveLength(2);
    });

    it("offers a stay where a vehicle stands without one, and shows a viewer no buttons", async () => {
        vi.mocked(getVehicleWorkshop).mockResolvedValue({
            data: workshop({ here: { id: 3, name: "Karosserie Schmitz", phone: null } }),
        });
        renderPanel("dispatcher", vehicle({ status: "IDLE" }));
        expect(await screen.findByText("Steht bei Karosserie Schmitz. Kein Termin geplant.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Aufenthalt anlegen" })).toBeInTheDocument();
    });

    it("shows a viewer the stay without buttons", async () => {
        vi.mocked(getVehicleWorkshop).mockResolvedValue({ data: workshop({ open: visit() }) });
        renderPanel("viewer");

        expect(await screen.findByText("Karosserie Schmitz")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Bearbeiten" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Verlauf" })).toBeInTheDocument();
    });
});
