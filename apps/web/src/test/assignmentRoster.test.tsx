import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Driver, DriverDetail, Vehicle } from "@fleet-live/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DriverAssignmentPanel } from "../components/drivers/DriverAssignmentPanel";
import { VehicleAssignmentPanel } from "../components/vehicles/VehicleAssignmentPanel";
import {
    VehiclesContext,
    type VehiclesContextValue,
} from "../context/vehiclesContext";
import { authUser, renderAuth } from "./renderAuth";

vi.mock("../api/drivers", () => ({
    listDrivers: vi.fn(),
    assignDriverVehicle: vi.fn(),
    unassignDriverVehicle: vi.fn(),
    setDriverCurrentVehicle: vi.fn(),
}));

vi.mock("../api/vehicles", () => ({
    listVehicles: vi.fn(),
}));

import {
    listDrivers,
    setDriverCurrentVehicle,
    unassignDriverVehicle,
} from "../api/drivers";
import { listVehicles } from "../api/vehicles";

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

const driverVehicle = (id: number, plate: string, isCurrent = false) => ({
    id,
    license_plate: plate,
    status: "IDLE" as const,
    active_alerts: 0,
    is_current: isCurrent,
    availability: "READY" as const,
});

const driverDetail = {
    id: 11,
    name: "Ben Arslan",
    vehicles: [
        driverVehicle(1, "HH-AA 1", true),
        driverVehicle(2, "HH-BB 2"),
        driverVehicle(3, "HH-CC 3"),
    ],
    current_vehicle: driverVehicle(1, "HH-AA 1", true),
} as unknown as DriverDetail;

const rosterDriver = (id: number, name: string): Driver =>
    ({
        id,
        name,
        current_vehicle_status: null,
        current_vehicle_plate: null,
    }) as unknown as Driver;

const vehicle = {
    id: 5,
    status: "IDLE",
    current_driver_id: 21,
    driver_name: "Anna Berg",
} as unknown as Vehicle;

const drivers = [
    rosterDriver(21, "Anna Berg"),
    rosterDriver(22, "Bora Celik"),
    rosterDriver(23, "Cem Dogan"),
];

const renderDriverPanel = (role: "dispatcher" | "viewer" = "dispatcher") =>
    renderAuth(
        <VehiclesContext.Provider value={contextValue}>
            <DriverAssignmentPanel
                driver={driverDetail}
                canWrite={role === "dispatcher"}
            />
        </VehiclesContext.Provider>,
        { user: authUser({ role }) },
    );

const renderVehiclePanel = (role: "dispatcher" | "viewer" = "dispatcher") =>
    renderAuth(
        <VehiclesContext.Provider value={contextValue}>
            <VehicleAssignmentPanel
                vehicle={vehicle}
                canWrite={role === "dispatcher"}
            />
        </VehiclesContext.Provider>,
        { user: authUser({ role }) },
    );

const checkboxes = () => screen.queryAllByRole("checkbox", { hidden: true });

beforeEach(() => {
    vi.mocked(unassignDriverVehicle).mockReset();
    vi.mocked(unassignDriverVehicle).mockResolvedValue(undefined as never);
    vi.mocked(setDriverCurrentVehicle).mockReset();
    vi.mocked(listVehicles).mockReset();
    vi.mocked(listDrivers).mockReset();
    vi.mocked(listDrivers).mockResolvedValue({
        data: drivers,
        meta: { page: 1, limit: 100, total: 3, pageCount: 1 },
    } as never);
    HTMLDialogElement.prototype.showModal ??= function (
        this: HTMLDialogElement,
    ) {
        this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
        this.removeAttribute("open");
    };
});

describe("Fahrzeuge panel on the driver detail", () => {
    it("shows row buttons and no checkboxes in normal mode", () => {
        renderDriverPanel();

        expect(screen.getByRole("button", { name: "Zuweisen" })).toBeVisible();
        expect(screen.getByRole("button", { name: "Auswählen" })).toBeVisible();
        expect(screen.queryByRole("button", { name: "Bearbeiten" })).toBeNull();
        expect(checkboxes()).toHaveLength(0);
        expect(screen.getAllByRole("button", { name: "Entfernen" })).toHaveLength(3);
        expect(screen.getByRole("button", { name: "Aufheben" })).toBeVisible();
        expect(screen.getAllByRole("button", { name: "Als aktuell" })).toHaveLength(2);
    });

    it("swaps row buttons for checkboxes in selection mode", () => {
        renderDriverPanel();
        fireEvent.click(screen.getByRole("button", { name: "Auswählen" }));

        expect(screen.queryByRole("button", { name: "Entfernen" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Als aktuell" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Zuweisen" })).toBeNull();
        // three rows plus the page checkbox
        expect(checkboxes()).toHaveLength(4);
        expect(screen.getByText("0 ausgewählt")).toBeVisible();
        expect(screen.getByRole("button", { name: "Abbrechen" })).toBeVisible();
    });

    it("counts ticked rows and removes exactly those after confirming", async () => {
        renderDriverPanel();
        fireEvent.click(screen.getByRole("button", { name: "Auswählen" }));
        fireEvent.click(screen.getByRole("checkbox", { name: "HH-BB 2 auswählen" }));
        fireEvent.click(screen.getByRole("checkbox", { name: "HH-CC 3 auswählen" }));

        expect(screen.getByText("2 ausgewählt")).toBeVisible();
        fireEvent.click(screen.getByRole("button", { name: "2 entfernen" }));

        const dialog = screen.getByRole("dialog", {
            name: "2 Zuweisungen entfernen?",
            hidden: true,
        });
        expect(within(dialog).getByText("HH-BB 2")).toBeInTheDocument();
        fireEvent.click(
            within(dialog).getByRole("button", { name: "Entfernen", hidden: true }),
        );

        await waitFor(() =>
            expect(unassignDriverVehicle).toHaveBeenCalledTimes(2),
        );
        expect(unassignDriverVehicle).toHaveBeenCalledWith(11, 2);
        expect(unassignDriverVehicle).toHaveBeenCalledWith(11, 3);
    });

    it("toggles a row by clicking its text in selection mode", () => {
        renderDriverPanel();
        fireEvent.click(screen.getByRole("button", { name: "Auswählen" }));
        fireEvent.click(screen.getByText("HH-BB 2"));

        expect(screen.getByText("1 ausgewählt")).toBeVisible();
    });

    it("ends selection mode with Escape", () => {
        renderDriverPanel();
        fireEvent.click(screen.getByRole("button", { name: "Auswählen" }));
        fireEvent.keyDown(document, { key: "Escape" });

        expect(screen.getByRole("button", { name: "Auswählen" })).toBeVisible();
        expect(checkboxes()).toHaveLength(0);
    });

    it("ends selection mode with Abbrechen", () => {
        renderDriverPanel();
        fireEvent.click(screen.getByRole("button", { name: "Auswählen" }));
        fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

        expect(screen.getByRole("button", { name: "Zuweisen" })).toBeVisible();
    });

    it("gives a viewer the list only", () => {
        renderDriverPanel("viewer");

        expect(screen.getByText("HH-AA 1")).toBeVisible();
        for (const name of [
            "Zuweisen",
            "Auswählen",
            "Entfernen",
            "Als aktuell",
            "Aufheben",
        ]) {
            expect(screen.queryByRole("button", { name })).toBeNull();
        }
        expect(checkboxes()).toHaveLength(0);
    });
});

describe("Fahrer dialog on the vehicle detail", () => {
    const openRoster = async (role: "dispatcher" | "viewer" = "dispatcher") => {
        renderVehiclePanel(role);
        fireEvent.click(
            await screen.findByRole("button", {
                name: role === "dispatcher" ? "Verwalten" : "Alle anzeigen",
            }),
        );
        await screen.findByText("Bora Celik");
    };

    it("shows row buttons and no checkboxes in normal mode", async () => {
        await openRoster();

        expect(screen.getByRole("button", { name: "Zuweisen" })).toBeVisible();
        expect(screen.getByRole("button", { name: "Auswählen" })).toBeVisible();
        expect(screen.queryByRole("button", { name: "Bearbeiten" })).toBeNull();
        expect(checkboxes()).toHaveLength(0);
        expect(screen.getAllByRole("button", { name: "Entfernen" })).toHaveLength(3);
    });

    it("removes the ticked drivers after confirming", async () => {
        await openRoster();
        fireEvent.click(screen.getByRole("button", { name: "Auswählen" }));

        expect(screen.queryByRole("button", { name: "Entfernen" })).toBeNull();
        fireEvent.click(screen.getByRole("checkbox", { name: "Bora Celik auswählen" }));
        fireEvent.click(screen.getByRole("checkbox", { name: "Cem Dogan auswählen" }));
        expect(screen.getByText("2 ausgewählt")).toBeVisible();

        fireEvent.click(screen.getByRole("button", { name: "2 entfernen" }));
        const dialog = screen.getByRole("dialog", {
            name: "2 Zuweisungen entfernen?",
            hidden: true,
        });
        fireEvent.click(
            within(dialog).getByRole("button", { name: "Entfernen", hidden: true }),
        );

        await waitFor(() =>
            expect(unassignDriverVehicle).toHaveBeenCalledTimes(2),
        );
        expect(unassignDriverVehicle).toHaveBeenCalledWith(22, 5);
        expect(unassignDriverVehicle).toHaveBeenCalledWith(23, 5);
    });

    it("lets the first Escape end the selection and not close the dialog", async () => {
        await openRoster();
        fireEvent.click(screen.getByRole("button", { name: "Auswählen" }));
        const dialog = screen.getByRole("dialog", { name: "Fahrer", hidden: true });

        const cancel = new Event("cancel", { cancelable: true });
        dialog.dispatchEvent(cancel);

        expect(cancel.defaultPrevented).toBe(true);
        await waitFor(() =>
            expect(screen.getByRole("button", { name: "Auswählen" })).toBeVisible(),
        );
        expect(checkboxes()).toHaveLength(0);

        // second Escape: nothing left to end, the dialog closes as usual
        const second = new Event("cancel", { cancelable: true });
        dialog.dispatchEvent(second);
        expect(second.defaultPrevented).toBe(false);
    });

    it("gives a viewer the list only", async () => {
        await openRoster("viewer");

        for (const name of [
            "Zuweisen",
            "Auswählen",
            "Entfernen",
            "Als aktuell",
            "Aufheben",
        ]) {
            expect(screen.queryByRole("button", { name })).toBeNull();
        }
    });
});
