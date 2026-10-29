import { fireEvent, screen, waitFor } from "@testing-library/react";
import {
    berlinTodayIso,
    type Vehicle,
    type VehicleWorkshop,
    type WorkshopVisit,
} from "@fleet-live/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/client";
import { WorkshopPanel } from "../components/vehicles/WorkshopPanel";
import {
    VehiclesContext,
    type VehiclesContextValue,
} from "../context/vehiclesContext";
import { authUser, renderAuth } from "./renderAuth";

vi.mock("../api/workshop", () => ({
    getVehicleWorkshop: vi.fn(),
    arriveWorkshopVisit: vi.fn(),
    cancelWorkshopVisit: vi.fn(),
    createWorkshopVisit: vi.fn(),
    updateWorkshopVisit: vi.fn(),
    finishWorkshopVisit: vi.fn(),
    getWorkshopPlaces: vi.fn(),
}));

vi.mock("../api/auth", () => ({
    listMembers: vi.fn(),
}));

import { listMembers } from "../api/auth";
import {
    arriveWorkshopVisit,
    createWorkshopVisit,
    finishWorkshopVisit,
    getVehicleWorkshop,
    getWorkshopPlaces,
} from "../api/workshop";

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

const vehicle = {
    id: 9,
    license_plate: "K-CV 9419",
    driver_name: null,
    availability: "READY",
    workshop: null,
} as unknown as Vehicle;

const visit = (overrides: Partial<WorkshopVisit> = {}): WorkshopVisit => ({
    id: 4,
    vehicle_id: 9,
    license_plate: "K-CV 9419",
    hu_due_on: "2026-02",
    reason: "HU",
    state: "PLANNED",
    place: "Prüfstelle Köln-Ost",
    planned_on: "2026-11-03",
    expected_on: "2026-11-04",
    assignee_user_id: 1,
    assignee_name: "Cihan Kurt",
    note: null,
    arrived_on: null,
    finished_on: null,
    cost_cents: null,
    result_note: null,
    created_at: "2026-10-27 15:40:00",
    ...overrides,
});

const workshop = (open: WorkshopVisit | null, past: WorkshopVisit[] = []): VehicleWorkshop => ({
    open,
    events: [],
    past,
});

const renderPanel = (role: "dispatcher" | "viewer" = "dispatcher") => {
    const onNotice = vi.fn();
    renderAuth(
        <VehiclesContext.Provider value={contextValue}>
            <section>
                <WorkshopPanel vehicle={vehicle} canWrite={role === "dispatcher"} onNotice={onNotice} />
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
            { user_id: 3, name: "Vera Viewer", email: "v@example.com", role: "viewer", invited: false },
        ],
    });
    vi.mocked(getWorkshopPlaces).mockResolvedValue({ data: ["Werkstatt Becker"] });
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
        this.removeAttribute("open");
    };
});

describe("WorkshopPanel", () => {
    it("shows a planned stay with Angekommen, Bearbeiten and Absagen", async () => {
        vi.mocked(getVehicleWorkshop).mockResolvedValue({ data: workshop(visit()) });
        vi.mocked(arriveWorkshopVisit).mockResolvedValue({
            data: visit({ state: "IN_WORKSHOP" }),
        });
        const { onNotice } = renderPanel();

        expect(await screen.findByText("Prüfstelle Köln-Ost")).toBeInTheDocument();
        expect(screen.getByText("Geplant")).toBeInTheDocument();
        expect(screen.getByText("03.11.2026")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Bearbeiten" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Absagen" })).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Angekommen" }));

        await waitFor(() => expect(arriveWorkshopVisit).toHaveBeenCalledWith(4));
        expect(onNotice).toHaveBeenLastCalledWith({
            text: "K-CV 9419 ist in der Werkstatt.",
            tone: "ok",
        });
    });

    it("says why the vehicle cannot arrive while it is on a trip", async () => {
        vi.mocked(getVehicleWorkshop).mockResolvedValue({ data: workshop(visit()) });
        vi.mocked(arriveWorkshopVisit).mockRejectedValue(
            new ApiError(
                "K-CV 9419 ist auf Fahrt. Es kommt in die Werkstatt, sobald die Fahrt endet.",
                409,
                undefined,
                "VEHICLE_DRIVING",
            ),
        );
        const { onNotice } = renderPanel();

        fireEvent.click(await screen.findByRole("button", { name: "Angekommen" }));

        await waitFor(() =>
            expect(onNotice).toHaveBeenLastCalledWith({
                text: "K-CV 9419 ist auf Fahrt. Es kommt in die Werkstatt, sobald die Fahrt endet.",
                tone: "error",
            }),
        );
    });

    it("finishes an HU only with the new month", async () => {
        const there = visit({ state: "IN_WORKSHOP", arrived_on: berlinTodayIso() });
        vi.mocked(getVehicleWorkshop).mockResolvedValue({ data: workshop(there) });
        vi.mocked(finishWorkshopVisit).mockResolvedValue({
            data: { ...there, state: "DONE" },
        });
        renderPanel();

        fireEvent.click(await screen.findByRole("button", { name: "Fertig melden" }));
        const dialog = await screen.findByRole("dialog", { name: "Fertig melden" });
        expect(dialog).toHaveTextContent("Bisher 02.2026");

        fireEvent.click(screen.getAllByRole("button", { name: "Fertig melden" }).at(-1)!);
        expect(await screen.findByText("Neue HU fällig fehlt.")).toBeInTheDocument();
        expect(finishWorkshopVisit).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText("Neue HU fällig"), {
            target: { value: "2028-10" },
        });
        fireEvent.change(screen.getByLabelText("Kosten in €"), {
            target: { value: "128,50" },
        });
        fireEvent.click(screen.getAllByRole("button", { name: "Fertig melden" }).at(-1)!);

        await waitFor(() =>
            expect(finishWorkshopVisit).toHaveBeenCalledWith(4, {
                finished_on: berlinTodayIso(),
                cost: "128,50",
                result_note: "",
                hu_due_on: "2028-10",
            }),
        );
    });

    it("plans a stay from the empty panel", async () => {
        vi.mocked(getVehicleWorkshop).mockResolvedValue({ data: workshop(null) });
        vi.mocked(createWorkshopVisit).mockResolvedValue({ data: visit() });
        const { onNotice } = renderPanel();

        expect(await screen.findByText(/Kein offener Aufenthalt/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "In die Werkstatt" }));

        await screen.findByRole("dialog", { name: "In die Werkstatt" });
        fireEvent.click(screen.getByLabelText("HU"));
        fireEvent.change(screen.getByLabelText("Werkstatt", { selector: "input" }), {
            target: { value: "Prüfstelle Köln-Ost" },
        });
        fireEvent.change(screen.getByLabelText("Termin am"), {
            target: { value: "2026-11-03" },
        });
        expect(await screen.findByRole("option", { name: "Lea Brandt" })).toBeInTheDocument();
        expect(screen.queryByRole("option", { name: "Vera Viewer" })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Termin planen" }));

        await waitFor(() =>
            expect(createWorkshopVisit).toHaveBeenCalledWith(9, {
                reason: "HU",
                place: "Prüfstelle Köln-Ost",
                planned_on: "2026-11-03",
                expected_on: null,
                assignee_user_id: 1,
                note: null,
                arrived: false,
            }),
        );
        expect(onNotice).toHaveBeenLastCalledWith({
            text: "Termin für K-CV 9419 am 03.11.2026 geplant.",
            tone: "ok",
        });
    });

    it("shows a viewer the stay without buttons", async () => {
        vi.mocked(getVehicleWorkshop).mockResolvedValue({ data: workshop(visit()) });
        renderPanel("viewer");

        expect(await screen.findByText("Prüfstelle Köln-Ost")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Angekommen" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Bearbeiten" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Verlauf" })).toBeInTheDocument();
    });
});
