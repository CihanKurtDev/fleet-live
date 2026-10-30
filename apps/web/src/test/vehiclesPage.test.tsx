import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type {
    Vehicle,
    VehicleListQuery,
    VehicleListResponse,
} from "@fleet-live/shared";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VehiclesPage } from "../pages/VehiclesPage";
import {
    VehiclesContext,
    type VehiclesContextValue,
} from "../context/vehiclesContext";
import { invalidateVehicleListCache } from "../api/vehicleListCache";
import { authUser, renderAuth } from "./renderAuth";

vi.mock("../api/vehicles", () => ({
    listVehicles: vi.fn(),
}));

vi.mock("../api/telemetryFocus", () => ({
    setTelemetryFocus: vi.fn(),
    clearTelemetryFocus: vi.fn(),
}));

import { listVehicles } from "../api/vehicles";

const vehicle = (overrides: Partial<Vehicle> & { id: number }): Vehicle => ({
    license_plate: `K-AB ${overrides.id}`,
    driver_name: null,
    fuel_level: 60,
    status: "IDLE",
    vin: null,
    vehicle_type: "VAN",
    hu_due_on: null,
    uvv_checked_on: null,
    uvv_due_on: null,
    active: true,
    depot: "Köln",
    home_site_id: null,
    cost_center: null,
    latitude: null,
    longitude: null,
    speed: 0,
    speed_limit_kmh: null,
    recorded_at: null,
    active_alerts: 0,
    speeding_open: false,
    open_alert_types: [],
    created_at: "2026-10-01 08:00:00",
    current_driver_id: null,
    availability: "READY",
    workshop: null,
    open_damages: 0,
    ...overrides,
});

const rows = [
    vehicle({ id: 1, driver_name: "Lisa Müller", current_driver_id: 7 }),
    vehicle({ id: 2, vehicle_type: "TRUCK", status: "STOPPED" }),
    vehicle({ id: 3, status: "DRIVING", speed: 80 }),
];

const listResponse = (data: Vehicle[]): VehicleListResponse => ({
    data,
    meta: {
        page: 1,
        limit: 10,
        total: data.length,
        pageCount: 1,
        counts: {
            all: 42,
            alerts: 5,
            low_fuel: 4,
            unassigned: 9,
            driving: 12,
            idle: 20,
            offline: 3,
            stopped: 7,
            in_depot: 7,
            speeding: 2,
            in_workshop: 1,
            workshop_due: 0,
            out_of_service: 0,
            damage_open: 0,
            not_drivable: 0,
            damage_unplanned: 0,
        },
    },
});

const deleteVehicles = vi.fn();

const vehicles = {
    listEpoch: 0,
    vehicleOverrides: {},
    streamConnection: "live",
    lastTelemetryAt: null,
    refetchLists: vi.fn(),
    createVehicle: vi.fn(),
    updateVehicle: vi.fn(),
    deleteVehicles,
    subscribeTripPath: vi.fn(() => () => undefined),
} satisfies VehiclesContextValue;

const renderPage = (role: "dispatcher" | "viewer" = "dispatcher") =>
    renderAuth(
        <VehiclesContext.Provider value={vehicles}>
            <Routes>
                <Route path="/vehicles" element={<VehiclesPage />} />
                <Route path="/vehicles/import" element={<p>Importseite</p>} />
                <Route path="/vehicles/:id" element={<p>Detailseite</p>} />
            </Routes>
        </VehiclesContext.Provider>,
        { user: authUser({ role }), route: "/vehicles" },
    );

const lastQuery = () =>
    vi.mocked(listVehicles).mock.calls.at(-1)?.[0] as VehicleListQuery;

describe("Fahrzeuge list page", () => {
    beforeEach(() => {
        invalidateVehicleListCache();
        deleteVehicles.mockReset();
        vi.mocked(listVehicles).mockReset();
        vi.mocked(listVehicles).mockResolvedValue(listResponse(rows));
        vi.stubGlobal(
            "ResizeObserver",
            class {
                observe() {}
                disconnect() {}
            },
        );

        // jsdom kennt showModal/close nicht in jeder Version.
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

    it("shows the situation sentence and filters with one pressed tile", async () => {
        renderPage();

        expect(
            await screen.findByText(
                "42 im Bestand · 5 mit offener Warnung · 9 ohne Fahrer",
            ),
        ).toBeInTheDocument();

        const tiles = screen.getByRole("group", { name: "Status" });
        const all = within(tiles).getByRole("button", { name: "Alle, 42" });
        const lowFuel = within(tiles).getByRole("button", {
            name: "Wenig Tank, 4",
        });
        expect(all).toHaveAttribute("aria-pressed", "true");
        expect(lowFuel).toHaveAttribute("aria-pressed", "false");

        fireEvent.click(lowFuel);

        await waitFor(() => expect(lastQuery().filter).toBe("low_fuel"));
        expect(lowFuel).toHaveAttribute("aria-pressed", "true");
        expect(all).toHaveAttribute("aria-pressed", "false");
        expect(
            within(tiles)
                .getAllByRole("button")
                .filter((tile) => tile.getAttribute("aria-pressed") === "true"),
        ).toHaveLength(1);
    });

    it("has a tile for every status, so the status tiles add up to Alle", async () => {
        renderPage();
        const tiles = await screen.findByRole("group", { name: "Status" });
        const countOf = (label: string) =>
            Number(
                within(tiles)
                    .getByRole("button", { name: new RegExp(`^${label}, \\d+$`) })
                    .getAttribute("aria-label")
                    ?.split(", ")[1],
            );

        const statuses = ["Auf Fahrt", "Standby", "Feierabend", "Kein Signal"];
        expect(
            statuses.reduce((sum, label) => sum + countOf(label), 0),
        ).toBe(countOf("Alle"));
        expect(countOf("Tempo jetzt")).toBe(2);

        fireEvent.click(
            within(tiles).getByRole("button", { name: "Feierabend, 7" }),
        );
        await waitFor(() => expect(lastQuery().filter).toBe("stopped"));

        fireEvent.click(
            within(tiles).getByRole("button", { name: "Tempo jetzt, 2" }),
        );
        await waitFor(() => expect(lastQuery().filter).toBe("speeding"));
    });

    it("keeps Kein Fahrer behind Weitere Filter", async () => {
        renderPage();
        await screen.findByText("K-AB 1");

        fireEvent.click(screen.getByRole("button", { name: "Weitere Filter" }));
        fireEvent.click(
            screen.getByRole("menuitemradio", { name: /Kein Fahrer/ }),
        );

        await waitFor(() => expect(lastQuery().filter).toBe("unassigned"));
        expect(
            screen.getByRole("button", { name: "Weitere Filter: Kein Fahrer" }),
        ).toBeInTheDocument();
        const tiles = screen.getByRole("group", { name: "Status" });
        expect(
            within(tiles)
                .getAllByRole("button")
                .some((tile) => tile.getAttribute("aria-pressed") === "true"),
        ).toBe(false);
    });

    it("opens the vehicle on a row click; the driver name is plain text", async () => {
        renderPage();

        const plate = await screen.findByText("K-AB 1");
        expect(screen.queryByRole("link", { name: "Lisa Müller" })).toBeNull();

        fireEvent.click(plate);

        expect(await screen.findByText("Detailseite")).toBeInTheDocument();
    });

    it("selects rows in selection mode and deletes after confirm", async () => {
        deleteVehicles.mockResolvedValue(undefined);
        renderPage();
        await screen.findByText("K-AB 1");

        expect(screen.queryByRole("checkbox")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Auswählen" }));

        const bar = screen.getByRole("region", { name: "Auswahl" });
        expect(within(bar).getByText("0 ausgewählt")).toBeInTheDocument();

        // In selection mode a row click toggles the row instead of opening it.
        fireEvent.click(screen.getByText("K-AB 1"));
        fireEvent.click(screen.getByRole("checkbox", { name: "K-AB 2 auswählen" }));
        expect(screen.queryByText("Detailseite")).toBeNull();
        expect(within(bar).getByText("2 ausgewählt")).toBeInTheDocument();

        const pageBox = within(bar).getByRole("checkbox", {
            name: "Alle auf dieser Seite auswählen",
        }) as HTMLInputElement;
        expect(pageBox.indeterminate).toBe(true);

        fireEvent.click(within(bar).getByRole("button", { name: "2 löschen" }));

        const dialog = screen.getByRole("dialog", {
            name: "2 Fahrzeuge löschen?",
            hidden: true,
        });
        expect(
            within(dialog).getByText(/Diese 2 Fahrzeuge wirklich löschen\?/),
        ).toBeInTheDocument();
        const list = within(dialog).getByRole("list", {
            name: "Ausgewählte Fahrzeuge",
            hidden: true,
        });
        expect(within(list).getByText("K-AB 1")).toBeInTheDocument();
        expect(within(list).getByText("K-AB 2")).toBeInTheDocument();
        expect(within(list).queryByText("K-AB 3")).toBeNull();
        expect(within(list).getByText("LKW · Feierabend")).toBeInTheDocument();

        fireEvent.click(
            within(dialog).getByRole("button", { name: "2 löschen", hidden: true }),
        );

        await waitFor(() => expect(deleteVehicles).toHaveBeenCalledWith([1, 2]));
        expect(await screen.findByText("2 Fahrzeuge gelöscht.")).toHaveAttribute(
            "role",
            "status",
        );
        expect(screen.queryByRole("region", { name: "Auswahl" })).toBeNull();
        expect(screen.getByRole("button", { name: "Auswählen" })).toBeInTheDocument();
    });

    it("ends selection mode with Escape", async () => {
        renderPage();
        await screen.findByText("K-AB 1");

        fireEvent.click(screen.getByRole("button", { name: "Auswählen" }));
        expect(screen.getByRole("region", { name: "Auswahl" })).toBeInTheDocument();

        fireEvent.keyDown(document, { key: "Escape" });

        expect(screen.queryByRole("region", { name: "Auswahl" })).toBeNull();
        expect(screen.queryByRole("checkbox")).toBeNull();
    });

    it("shows the dispatcher actions in the header", async () => {
        renderPage();
        await screen.findByText("K-AB 1");

        expect(screen.getByRole("button", { name: "Importieren" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Fahrzeug anlegen" })).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Exportieren" }));
        expect(
            screen.getByRole("menuitem", { name: "Fahrzeuge (CSV)" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("menuitem", { name: "Fahrten (CSV)" }),
        ).toBeInTheDocument();
    });

    it("confirms a created vehicle with a notice", async () => {
        renderPage();
        await screen.findByText("K-AB 1");

        fireEvent.click(screen.getByRole("button", { name: "Fahrzeug anlegen" }));
        fireEvent.change(await screen.findByLabelText("Kennzeichen"), {
            target: { value: "QA-QA 1" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Anlegen" }));

        expect(
            await screen.findByText("Fahrzeug QA-QA 1 angelegt."),
        ).toBeInTheDocument();
    });

    it("gives a viewer no actions and no selection mode", async () => {
        renderPage("viewer");
        await screen.findByText("K-AB 1");

        for (const name of [
            "Auswählen",
            "Importieren",
            "Exportieren",
            "Fahrzeug anlegen",
        ]) {
            expect(screen.queryByRole("button", { name })).toBeNull();
        }
        expect(screen.getByRole("searchbox", { name: "Kennzeichen oder Fahrer suchen" })).toBeInTheDocument();
    });

    const emptyCompany = (): VehicleListResponse => {
        const response = listResponse([]);
        response.meta.total = 0;
        response.meta.counts = Object.fromEntries(
            Object.keys(response.meta.counts).map((key) => [key, 0]),
        ) as VehicleListResponse["meta"]["counts"];
        return response;
    };

    it("leads an empty company to the import instead of a dead end", async () => {
        vi.mocked(listVehicles).mockResolvedValue(emptyCompany());
        renderPage();

        expect(
            await screen.findByRole("heading", { name: "Noch keine Fahrzeuge" }),
        ).toBeInTheDocument();
        expect(
            screen.getByText("Noch keine Fahrzeuge in dieser Firma."),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Bestand importieren" }),
        ).toBeInTheDocument();
        // Nothing to select, filter, search or export yet; the controls stay put.
        expect(screen.getByRole("button", { name: "Auswählen" })).toBeDisabled();
        expect(
            screen.getByRole("searchbox", { name: "Kennzeichen oder Fahrer suchen" }),
        ).toBeDisabled();
        expect(screen.getByRole("button", { name: "Exportieren" })).toBeDisabled();

        fireEvent.click(screen.getByRole("button", { name: "Bestand importieren" }));
        expect(await screen.findByText("Importseite")).toBeInTheDocument();
    });

    it("tells a viewer of an empty company who fills it", async () => {
        vi.mocked(listVehicles).mockResolvedValue(emptyCompany());
        renderPage("viewer");

        expect(
            await screen.findByText(
                "Ein Dispatcher deiner Firma legt den Bestand an. Danach siehst du hier alles live.",
            ),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Bestand importieren" }),
        ).toBeNull();
    });
});
