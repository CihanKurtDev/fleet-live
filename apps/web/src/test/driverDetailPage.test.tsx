import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type {
    Alert,
    AlertListResponse,
    Driver,
    DriverDetail,
    DriverListResponse,
} from "@fleet-live/shared";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DriverDetailPage } from "../pages/DriverDetailPage";
import { DriversPage } from "../pages/DriversPage";
import {
    VehiclesContext,
    type VehiclesContextValue,
} from "../context/vehiclesContext";
import { ApiError } from "../api/client";
import { authUser, renderAuth } from "./renderAuth";

vi.mock("../api/drivers", () => ({
    listDrivers: vi.fn(),
    getDriver: vi.fn(),
    deleteDriver: vi.fn(),
    updateDriver: vi.fn(),
    assignDriverVehicle: vi.fn(),
    unassignDriverVehicle: vi.fn(),
    setDriverCurrentVehicle: vi.fn(),
}));

vi.mock("../api/alerts", () => ({
    listAlerts: vi.fn(),
    resolveAlert: vi.fn(),
}));

vi.mock("../api/due", () => ({
    getDueSettings: vi.fn(),
}));

vi.mock("../api/vehicles", () => ({
    listVehicles: vi.fn(),
    getVehicle: vi.fn(),
}));

vi.mock("../api/telemetryFocus", () => ({
    setTelemetryFocus: vi.fn(),
    clearTelemetryFocus: vi.fn(),
}));

import { deleteDriver, getDriver, listDrivers } from "../api/drivers";
import { listAlerts, resolveAlert } from "../api/alerts";
import { getDueSettings } from "../api/due";

const baseDriver: DriverDetail = {
    id: 11,
    name: "Ben Arslan",
    phone: null,
    licence_expires_on: null,
    licence_checked_on: null,
    active: true,
    created_at: "2026-01-01 00:00:00",
    vehicle_count: 2,
    vehicle_plate: null,
    current_vehicle_plate: null,
    current_vehicle_status: null,
    open_warnings: 16,
    last_warning_at: null,
    counts: { all: 20, SPEEDING: 20, LOW_FUEL: 0, OFFLINE: 0 },
    vehicles: [
        {
            id: 1,
            license_plate: "HH-FN 1218",
            status: "IDLE",
            active_alerts: 0,
            is_current: true,
            availability: "READY",
        },
        {
            id: 2,
            license_plate: "HH-FN 1633",
            status: "IDLE",
            active_alerts: 0,
            is_current: false,
            availability: "READY",
        },
    ],
    current_vehicle: {
        id: 1,
        license_plate: "HH-FN 1218",
        status: "IDLE",
        active_alerts: 0,
        is_current: true,
        availability: "READY",
    },
};

const alert = (id: number, overrides: Partial<Alert> = {}): Alert => ({
    id,
    vehicle_id: 1,
    driver_id: 11,
    license_plate: "HH-FN 1218",
    driver_name: "Ben Arslan",
    type: "SPEEDING",
    severity: "MEDIUM",
    message: "Tempo",
    details: {
        max_speed_kmh: 144,
        limit_kmh: 50,
        duration_s: 120,
    },
    created_at: "2026-10-14 08:00:00",
    ended_at: "2026-10-14 08:02:00",
    resolved_at: null,
    ...overrides,
});

const alertPage = (data: Alert[], total = data.length): AlertListResponse =>
    ({
        data,
        meta: {
            page: 1,
            limit: 5,
            total,
            pageCount: Math.max(1, Math.ceil(total / 5)),
            counts: { all: total, open: total, resolved: 0 },
        },
    }) as unknown as AlertListResponse;

const listRow: Driver = { ...baseDriver };
const listResponse: DriverListResponse = {
    data: [listRow],
    meta: {
        page: 1,
        limit: 10,
        total: 1,
        pageCount: 1,
        counts: { all: 1, talk: 1, without_vehicle: 0 },
    },
};

const refetchLists = vi.fn();
const vehicles = {
    listEpoch: 0,
    vehicleOverrides: {},
    streamConnection: "live",
    lastTelemetryAt: null,
    refetchLists,
    createVehicle: vi.fn(),
    updateVehicle: vi.fn(),
    deleteVehicles: vi.fn(),
    subscribeTripPath: vi.fn(() => () => undefined),
} satisfies VehiclesContextValue;

const renderDetail = (role: "dispatcher" | "viewer" = "dispatcher") =>
    renderAuth(
        <VehiclesContext.Provider value={vehicles}>
            <Routes>
                <Route path="/drivers" element={<DriversPage />} />
                <Route path="/drivers/:id" element={<DriverDetailPage />} />
            </Routes>
        </VehiclesContext.Provider>,
        { user: authUser({ role }), route: "/drivers/11" },
    );

describe("Fahrer detail page", () => {
    beforeEach(() => {
        refetchLists.mockReset();
        vi.mocked(deleteDriver).mockReset();
        vi.mocked(getDriver).mockReset();
        vi.mocked(getDriver).mockResolvedValue(baseDriver);
        vi.mocked(listDrivers).mockReset();
        vi.mocked(listDrivers).mockResolvedValue(listResponse);
        vi.mocked(listAlerts).mockReset();
        vi.mocked(listAlerts).mockResolvedValue(
            alertPage([alert(1), alert(2, { resolved_at: "2026-10-14 09:00:00" })], 2),
        );
        vi.mocked(resolveAlert).mockReset();
        vi.mocked(getDueSettings).mockReset();
        vi.mocked(getDueSettings).mockResolvedValue({
            data: {
                due_lead_days: null,
                licence_check_months: null,
                lead_days: 30,
                check_months: 6,
            },
        });
        vi.stubGlobal(
            "ResizeObserver",
            class {
                observe() {}
                disconnect() {}
            },
        );
        HTMLDialogElement.prototype.showModal ??= function (
            this: HTMLDialogElement,
        ) {
            this.setAttribute("open", "");
        };
        HTMLDialogElement.prototype.close ??= function (
            this: HTMLDialogElement,
        ) {
            this.removeAttribute("open");
        };
    });

    it("shows the header, the hints and the panels from real data", async () => {
        renderDetail();

        expect(
            await screen.findByRole("heading", { name: "Ben Arslan" }),
        ).toBeInTheDocument();
        expect(screen.getByText("16 offene Tempo-Warnungen")).toBeInTheDocument();
        expect(
            screen.getByText(
                "fährt HH-FN 1218 · darf 2 Fahrzeuge fahren · Telefon fehlt",
            ),
        ).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "← Fahrer" })).toHaveAttribute(
            "href",
            "/drivers",
        );

        const hints = screen.getByRole("region", { name: "Hinweise" });
        expect(
            within(hints).getByText("Führerschein-Ablaufdatum fehlt"),
        ).toBeInTheDocument();
        expect(
            within(hints).getByText("Führerscheinkontrolle noch nie eingetragen"),
        ).toBeInTheDocument();
        expect(within(hints).getByText("Telefon fehlt")).toBeInTheDocument();
        expect(
            within(hints).getAllByRole("button", { name: "Eintragen" }),
        ).toHaveLength(3);

        expect(screen.getByRole("region", { name: "Jetzt" })).toBeInTheDocument();
        expect(screen.getByRole("region", { name: "Stammdaten" })).toBeInTheDocument();
        const warnings = await screen.findByRole("region", {
            name: "Tempo-Warnungen",
        });
        expect(
            (await within(warnings).findAllByText("144 km/h bei Limit 50 · 2 Min."))[0],
        ).toBeInTheDocument();
        expect(screen.getByRole("region", { name: "Fahrzeuge" })).toBeInTheDocument();
        expect(vi.mocked(listAlerts).mock.calls[0][0]).toMatchObject({
            driver_id: 11,
            type: "SPEEDING",
            limit: 5,
        });
    });

    it("opens the edit form from a hint", async () => {
        renderDetail();
        const hints = await screen.findByRole("region", { name: "Hinweise" });

        fireEvent.click(within(hints).getAllByRole("button", { name: "Eintragen" })[0]);

        expect(
            await screen.findByRole("dialog", { name: "Fahrer bearbeiten", hidden: true }),
        ).toBeInTheDocument();
    });

    it("focuses the field a hint asks for", async () => {
        renderDetail();
        const hints = await screen.findByRole("region", { name: "Hinweise" });
        const buttons = within(hints).getAllByRole("button", { name: "Eintragen" });

        fireEvent.click(buttons[1]);
        expect(
            await screen.findByLabelText("Führerschein kontrolliert am", {
                selector: "input",
            }),
        ).toHaveFocus();
    });

    it("resolves an open warning with the row button", async () => {
        vi.mocked(resolveAlert).mockResolvedValue(alert(1));
        renderDetail();
        const warnings = await screen.findByRole("region", {
            name: "Tempo-Warnungen",
        });
        await within(warnings).findAllByText("144 km/h bei Limit 50 · 2 Min.");

        // Only the open row has the button; rows are not clickable.
        const buttons = within(warnings).getAllByRole("button", {
            name: "Erledigen",
        });
        expect(buttons).toHaveLength(1);
        expect(within(warnings).queryByRole("link")).toBeNull();

        fireEvent.click(buttons[0]);

        await waitFor(() => expect(resolveAlert).toHaveBeenCalledWith(1));
        expect(refetchLists).toHaveBeenCalled();
    });

    it("deletes through the menu, then returns to the list with a notice", async () => {
        vi.mocked(deleteDriver).mockResolvedValue(undefined);
        renderAuth(
            <VehiclesContext.Provider value={vehicles}>
                <Routes>
                    <Route path="/drivers" element={<DriversPage />} />
                    <Route path="/drivers/:id" element={<DriverDetailPage />} />
                </Routes>
            </VehiclesContext.Provider>,
            { user: authUser(), route: "/drivers" },
        );

        fireEvent.click(await screen.findByText("Ben Arslan"));
        await screen.findByRole("heading", { name: "Ben Arslan" });

        fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
        fireEvent.click(screen.getByRole("menuitem", { name: "Fahrer löschen" }));

        const dialog = screen.getByRole("dialog", {
            name: "Fahrer löschen?",
            hidden: true,
        });
        expect(within(dialog).getByText("HH-FN 1218")).toBeInTheDocument();
        fireEvent.click(
            within(dialog).getByRole("button", { name: "Löschen", hidden: true }),
        );

        await waitFor(() => expect(deleteDriver).toHaveBeenCalledWith(11));
        expect(await screen.findByText("1 Fahrer gelöscht.")).toHaveAttribute(
            "role",
            "status",
        );
        expect(screen.getByRole("table", { name: "Fahrerliste" })).toBeInTheDocument();
        expect(refetchLists).toHaveBeenCalled();
    });

    it("shows the 409 message in the dialog and stays on the page", async () => {
        vi.mocked(deleteDriver).mockRejectedValue(
            new ApiError(
                "Ben Arslan ist noch unterwegs auf HH-FN 1218. Der Fahrer lässt sich erst nach der Fahrt löschen.",
                409,
            ),
        );
        renderDetail();
        await screen.findByRole("heading", { name: "Ben Arslan" });

        fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
        fireEvent.click(screen.getByRole("menuitem", { name: "Fahrer löschen" }));
        const dialog = screen.getByRole("dialog", {
            name: "Fahrer löschen?",
            hidden: true,
        });
        fireEvent.click(
            within(dialog).getByRole("button", { name: "Löschen", hidden: true }),
        );

        expect(
            await within(dialog).findByText(/noch unterwegs auf HH-FN 1218/),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("heading", { name: "Ben Arslan" }),
        ).toBeInTheDocument();
        expect(refetchLists).not.toHaveBeenCalled();
    });

    it("shows the error with a retry instead of loading forever", async () => {
        vi.mocked(getDriver).mockRejectedValueOnce(new ApiError("Testfehler", 500));
        renderDetail();

        const retry = await screen.findByRole("button", {
            name: "Erneut versuchen",
        });
        expect(screen.getByText("Testfehler")).toBeInTheDocument();
        expect(screen.queryByText("Fahrer wird geladen…")).toBeNull();

        fireEvent.click(retry);

        expect(
            await screen.findByRole("heading", { name: "Ben Arslan" }),
        ).toBeInTheDocument();
    });

    it("gives a viewer no actions", async () => {
        renderDetail("viewer");
        await screen.findByRole("heading", { name: "Ben Arslan" });

        for (const name of [
            "Bearbeiten",
            "Weitere Aktionen",
            "Eintragen",
            "Zuweisen",
            "Erledigen",
        ]) {
            expect(screen.queryByRole("button", { name })).toBeNull();
        }
        await screen.findAllByText("144 km/h bei Limit 50 · 2 Min.");
        expect(screen.queryByRole("button", { name: "Erledigen" })).toBeNull();
    });
});
