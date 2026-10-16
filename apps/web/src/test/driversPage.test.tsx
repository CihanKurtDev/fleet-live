import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type {
    Driver,
    DriverListQuery,
    DriverListResponse,
} from "@fleet-live/shared";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DriversPage } from "../pages/DriversPage";
import {
    VehiclesContext,
    type VehiclesContextValue,
} from "../context/vehiclesContext";
import { ApiError } from "../api/client";
import { authUser, renderAuth } from "./renderAuth";

vi.mock("../api/drivers", () => ({
    listDrivers: vi.fn(),
    deleteDriver: vi.fn(),
}));

import { deleteDriver, listDrivers } from "../api/drivers";

const driver = (overrides: Partial<Driver> & { id: number }): Driver => ({
    name: `Fahrer ${overrides.id}`,
    phone: null,
    licence_expires_on: null,
    licence_checked_on: null,
    active: true,
    created_at: "2026-01-01 00:00:00",
    vehicle_count: 0,
    vehicle_plate: null,
    current_vehicle_plate: null,
    current_vehicle_status: null,
    open_warnings: 0,
    last_warning_at: null,
    counts: { all: 0, SPEEDING: 0, LOW_FUEL: 0, OFFLINE: 0 },
    ...overrides,
});

const rows = [
    driver({
        id: 11,
        name: "Ben Arslan",
        phone: "0171 123456",
        current_vehicle_plate: "HH-FN 1218",
        vehicle_count: 4,
        open_warnings: 16,
        counts: { all: 20, SPEEDING: 20, LOW_FUEL: 0, OFFLINE: 0 },
    }),
    driver({
        id: 12,
        name: "Paul Schmidt",
        vehicle_count: 2,
        open_warnings: 0,
        counts: { all: 3, SPEEDING: 3, LOW_FUEL: 0, OFFLINE: 0 },
    }),
    driver({ id: 13, name: "Sara Yilmaz" }),
];

const listResponse = (data: Driver[]): DriverListResponse => ({
    data,
    meta: {
        page: 1,
        limit: 10,
        total: data.length,
        pageCount: 1,
        counts: { all: 2851, talk: 5, without_vehicle: 31 },
    },
});

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

const renderPage = (
    role: "dispatcher" | "viewer" = "dispatcher",
    route = "/drivers",
) =>
    renderAuth(
        <VehiclesContext.Provider value={vehicles}>
            <Routes>
                <Route path="/drivers" element={<DriversPage />} />
                <Route path="/drivers/:id" element={<p>Detailseite</p>} />
            </Routes>
        </VehiclesContext.Provider>,
        { user: authUser({ role }), route },
    );

const lastQuery = () =>
    vi.mocked(listDrivers).mock.calls.at(-1)?.[0] as DriverListQuery;

describe("Fahrer list page", () => {
    beforeEach(() => {
        refetchLists.mockReset();
        vi.mocked(deleteDriver).mockReset();
        vi.mocked(listDrivers).mockReset();
        vi.mocked(listDrivers).mockResolvedValue(listResponse(rows));
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

    it("shows the situation sentence, the columns and one list page", async () => {
        renderPage();

        expect(
            await screen.findByText(
                "2.851 Fahrer · sortiert nach offenen Tempo-Warnungen",
            ),
        ).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Fahrer" })).toBeInTheDocument();

        const table = screen.getByRole("table", { name: "Fahrerliste" });
        expect(within(table).getByText("HH-FN 1218")).toBeInTheDocument();
        expect(within(table).getByText("4 freigegeben")).toBeInTheDocument();
        expect(within(table).getByText("20 gesamt")).toBeInTheDocument();
        expect(within(table).getByText("16 offen")).toBeInTheDocument();
        expect(within(table).getAllByText("keine offen")).toHaveLength(2);
        expect(within(table).getAllByText("Kein Fahrzeug").length).toBeGreaterThan(0);
        expect(screen.queryByText("Fahrer D")).toBeNull();
    });

    it("filters with the tiles; exactly one is pressed", async () => {
        renderPage();
        await screen.findByText("Ben Arslan");

        const tiles = screen.getByRole("group", { name: "Filter" });
        const all = within(tiles).getByRole("button", { name: "Alle, 2.851" });
        const talk = within(tiles).getByRole("button", {
            name: "Gespräch führen, 5",
        });
        const without = within(tiles).getByRole("button", {
            name: "Ohne Fahrzeug, 31",
        });
        expect(within(tiles).getByText("ab 5 offenen Tempo-Warnungen")).toBeInTheDocument();
        expect(all).toHaveAttribute("aria-pressed", "true");

        fireEvent.click(talk);
        await waitFor(() => expect(lastQuery().min_open_warnings).toBe(5));
        expect(talk).toHaveAttribute("aria-pressed", "true");
        expect(all).toHaveAttribute("aria-pressed", "false");

        fireEvent.click(without);
        await waitFor(() => expect(lastQuery().without_vehicle).toBe(true));
        expect(lastQuery().min_open_warnings).toBeUndefined();
        expect(without).toHaveAttribute("aria-pressed", "true");
        expect(talk).toHaveAttribute("aria-pressed", "false");
        expect(
            within(tiles)
                .getAllByRole("button")
                .filter((tile) => tile.getAttribute("aria-pressed") === "true"),
        ).toHaveLength(1);

        fireEvent.click(all);
        await waitFor(() => expect(lastQuery().without_vehicle).toBeUndefined());
        expect(all).toHaveAttribute("aria-pressed", "true");
    });

    it("reads the tile from the URL", async () => {
        renderPage("dispatcher", "/drivers?min_open_warnings=5");
        await screen.findByText("Ben Arslan");

        expect(
            screen.getByRole("button", { name: "Gespräch führen, 5" }),
        ).toHaveAttribute("aria-pressed", "true");
        expect(lastQuery().min_open_warnings).toBe(5);
    });

    it("opens the driver on a row click; the name is plain text, not a link", async () => {
        renderPage();

        const name = await screen.findByText("Ben Arslan");
        expect(screen.queryByRole("link", { name: "Ben Arslan" })).toBeNull();
        expect(screen.queryByRole("link")).toBeNull();

        fireEvent.click(name);

        expect(await screen.findByText("Detailseite")).toBeInTheDocument();
    });

    it("selects drivers, lists them in the dialog and deletes after confirm", async () => {
        vi.mocked(deleteDriver).mockResolvedValue(undefined);
        renderPage();
        await screen.findByText("Ben Arslan");

        expect(screen.queryByRole("checkbox")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Auswählen" }));

        const bar = screen.getByRole("region", { name: "Auswahl" });
        fireEvent.click(screen.getByText("Ben Arslan"));
        fireEvent.click(
            screen.getByRole("checkbox", { name: "Paul Schmidt auswählen" }),
        );
        expect(screen.queryByText("Detailseite")).toBeNull();
        expect(within(bar).getByText("2 ausgewählt")).toBeInTheDocument();

        fireEvent.click(within(bar).getByRole("button", { name: "2 löschen" }));

        const dialog = screen.getByRole("dialog", {
            name: "2 Fahrer löschen?",
            hidden: true,
        });
        expect(
            within(dialog).getByText(
                /Diese 2 Fahrer wirklich löschen\? Das kann nicht rückgängig gemacht werden\./,
            ),
        ).toBeInTheDocument();
        const list = within(dialog).getByRole("list", {
            name: "Ausgewählte Fahrer",
            hidden: true,
        });
        expect(within(list).getByText("Ben Arslan")).toBeInTheDocument();
        expect(within(list).getByText("HH-FN 1218")).toBeInTheDocument();
        expect(within(list).getByText("Paul Schmidt")).toBeInTheDocument();
        expect(within(list).getByText("kein Fahrzeug")).toBeInTheDocument();
        expect(within(list).queryByText("Sara Yilmaz")).toBeNull();

        fireEvent.click(
            within(dialog).getByRole("button", { name: "2 löschen", hidden: true }),
        );

        await waitFor(() => expect(deleteDriver).toHaveBeenCalledTimes(2));
        expect(deleteDriver).toHaveBeenCalledWith(11);
        expect(deleteDriver).toHaveBeenCalledWith(12);
        expect(await screen.findByText("2 Fahrer gelöscht.")).toHaveAttribute(
            "role",
            "status",
        );
        expect(refetchLists).toHaveBeenCalled();
        expect(screen.queryByRole("region", { name: "Auswahl" })).toBeNull();
        expect(screen.getByRole("button", { name: "Auswählen" })).toBeInTheDocument();
    });

    it("shows the 409 message in the dialog and keeps that driver selected", async () => {
        vi.mocked(deleteDriver).mockImplementation(async (id: number) => {
            if (id === 11) {
                throw new ApiError(
                    "Ben Arslan ist noch unterwegs auf HH-FN 1218. Der Fahrer lässt sich erst nach der Fahrt löschen.",
                    409,
                );
            }
        });
        renderPage();
        await screen.findByText("Ben Arslan");

        fireEvent.click(screen.getByRole("button", { name: "Auswählen" }));
        fireEvent.click(screen.getByText("Ben Arslan"));
        fireEvent.click(screen.getByText("Paul Schmidt"));
        const bar = screen.getByRole("region", { name: "Auswahl" });
        fireEvent.click(within(bar).getByRole("button", { name: "2 löschen" }));

        const dialog = screen.getByRole("dialog", {
            name: "2 Fahrer löschen?",
            hidden: true,
        });
        fireEvent.click(
            within(dialog).getByRole("button", { name: "2 löschen", hidden: true }),
        );

        expect(
            await within(dialog).findByText(
                /noch unterwegs auf HH-FN 1218/,
                undefined,
                { timeout: 2000 },
            ),
        ).toBeInTheDocument();
        expect(deleteDriver).toHaveBeenCalledWith(12);

        // Only the failed driver is left in the dialog and stays selected.
        const list = within(dialog).getByRole("list", {
            name: "Ausgewählte Fahrer",
            hidden: true,
        });
        expect(within(list).getByText("Ben Arslan")).toBeInTheDocument();
        expect(within(list).queryByText("Paul Schmidt")).toBeNull();
        expect(screen.getByRole("region", { name: "Auswahl" })).toBeInTheDocument();
        expect(refetchLists).toHaveBeenCalled();
        expect(screen.queryByText("2 Fahrer gelöscht.")).toBeNull();
    });

    it("shows the dispatcher action in the header", async () => {
        renderPage();
        await screen.findByText("Ben Arslan");

        expect(
            screen.getByRole("button", { name: "Fahrer anlegen" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("searchbox", { name: "Fahrer suchen" }),
        ).toBeInTheDocument();
    });

    it("gives a viewer no actions and no selection mode", async () => {
        renderPage("viewer");
        await screen.findByText("Ben Arslan");

        for (const name of ["Auswählen", "Fahrer anlegen"]) {
            expect(screen.queryByRole("button", { name })).toBeNull();
        }
        expect(
            screen.getByRole("searchbox", { name: "Fahrer suchen" }),
        ).toBeInTheDocument();
        expect(screen.queryByRole("checkbox")).toBeNull();
    });

    it("offers Filter aufheben when a tile filter finds nobody", async () => {
        vi.mocked(listDrivers).mockResolvedValue({
            ...listResponse([]),
            meta: { ...listResponse([]).meta, counts: { all: 3, talk: 0, without_vehicle: 0 } },
        });
        renderPage("dispatcher", "/drivers?without_vehicle=true");

        expect(
            await screen.findByText("Keine Fahrer passen zu Suche und Filter."),
        ).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Filter aufheben" }));

        await waitFor(() => expect(lastQuery().without_vehicle).toBeUndefined());
    });
});
