import { fireEvent, screen, within } from "@testing-library/react";
import type {
    Driver,
    DriverListQuery,
    DriverListResponse,
    DueListItem,
    DueListQuery,
    DueListResponse,
} from "@fleet-live/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DriversPage } from "../pages/DriversPage";
import { authUser, renderAuth } from "./renderAuth";

vi.mock("../api/drivers", () => ({
    listDrivers: vi.fn(),
}));

vi.mock("../api/due", () => ({
    listDue: vi.fn(),
}));

vi.mock("../context/vehiclesContext", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../context/vehiclesContext")>()),
    useVehicles: () => ({ listEpoch: 0, refetchLists: vi.fn() }),
}));

import { listDrivers } from "../api/drivers";
import { listDue } from "../api/due";

const driver = (overrides: Partial<Driver>): Driver => ({
    id: 1,
    name: "Fahrer",
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

const driverPage = (data: Driver[], total = data.length): DriverListResponse => ({
    data,
    meta: { page: 1, limit: 25, total, pageCount: 1 },
});

const duePage = (data: DueListItem[], total = data.length): DueListResponse => ({
    data,
    meta: {
        page: 1,
        limit: 25,
        total,
        pageCount: 1,
        counts: { overdue: 0, soon: 0, missing: 0 },
        kind_counts: {
            all: 0,
            hu: 0,
            uvv: 0,
            licence_expiry: 0,
            licence_check: 0,
        },
    },
});

const talker = driver({
    id: 11,
    name: "Ben Arslan",
    current_vehicle_plate: "HH-FN 1218",
    open_warnings: 16,
    vehicle_count: 1,
});
const unassigned = driver({ id: 12, name: "Paul Schmidt", vehicle_count: 2 });
const noPermit = driver({ id: 13, name: "Sara Yilmaz", vehicle_count: 0 });

beforeEach(() => {
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {}
            disconnect() {}
        },
    );

    vi.mocked(listDrivers).mockReset();
    vi.mocked(listDrivers).mockImplementation(async (query: DriverListQuery) => {
        if (query.min_open_warnings !== undefined) {
            return driverPage([talker], 23);
        }

        if (query.without_vehicle) {
            return driverPage([unassigned, noPermit], 31);
        }

        return driverPage([talker, unassigned, noPermit], 412);
    });

    vi.mocked(listDue).mockReset();
    vi.mocked(listDue).mockImplementation(async (query: DueListQuery) => {
        if (query.state === "missing" && query.kind === "licence_expiry") {
            return duePage(
                [
                    {
                        kind: "licence_expiry",
                        state: "missing",
                        due_on: null,
                        vehicle_id: null,
                        driver_id: 21,
                        label: "Niklas Neumann",
                    },
                ],
                26,
            );
        }

        if (query.state === "overdue" && query.kind === "licence_check") {
            return duePage(
                [
                    {
                        kind: "licence_check",
                        state: "overdue",
                        due_on: null,
                        vehicle_id: null,
                        driver_id: 22,
                        label: "Elif Krüger",
                    },
                ],
                30,
            );
        }

        return duePage([]);
    });
});

describe("drivers board", () => {
    it("shows three columns from the driver and deadline lists", async () => {
        renderAuth(<DriversPage />, {
            user: authUser(),
            route: "/drivers",
        });

        const talk = await screen.findByRole("region", { name: "Gespräch führen" });
        expect(await within(talk).findByText("Ben Arslan")).toBeInTheDocument();
        expect(within(talk).getByText("HH-FN 1218")).toBeInTheDocument();
        expect(within(talk).getByText("23")).toBeInTheDocument();
        expect(
            within(talk).getByRole("link", { name: "Warnungen von Ben Arslan" }),
        ).toHaveAttribute("href", "/alerts?driver_id=11&type=SPEEDING");
        expect(
            within(talk).getByRole("link", { name: "Alle 23 anzeigen →" }),
        ).toHaveAttribute(
            "href",
            "/drivers?min_open_warnings=5&ansicht=liste",
        );

        const papers = screen.getByRole("region", { name: "Papiere fehlen" });
        expect(await within(papers).findByText("Elif Krüger")).toBeInTheDocument();
        expect(within(papers).getByText("nie kontrolliert")).toBeInTheDocument();
        expect(within(papers).getByText("Ablaufdatum fehlt")).toBeInTheDocument();
        expect(within(papers).getByText("56")).toBeInTheDocument();
        expect(
            within(papers).getByRole("link", { name: "Kontrolle 30 →" }),
        ).toHaveAttribute("href", "/fristen?state=overdue&kind=licence_check");
        expect(
            within(papers).getByRole("link", { name: "Datum fehlt 26 →" }),
        ).toHaveAttribute("href", "/fristen?state=missing&kind=licence_expiry");

        const without = screen.getByRole("region", { name: "Ohne Fahrzeug" });
        expect(
            await within(without).findByText("2 Freigaben · nicht eingeteilt"),
        ).toBeInTheDocument();
        expect(within(without).getByText("keine Freigabe")).toBeInTheDocument();
        expect(
            within(without).getByRole("link", { name: "Alle 31 anzeigen →" }),
        ).toHaveAttribute("href", "/drivers?without_vehicle=true&ansicht=liste");

        expect(
            screen.getByRole("button", { name: "Neuer Fahrer" }),
        ).toBeInTheDocument();
        expect(listDrivers).toHaveBeenCalledWith(
            expect.objectContaining({ min_open_warnings: 5 }),
            expect.anything(),
        );
        expect(listDrivers).toHaveBeenCalledWith(
            expect.objectContaining({ without_vehicle: true }),
            expect.anything(),
        );
    });

    it("hides the create button for a viewer", async () => {
        renderAuth(<DriversPage />, {
            user: authUser({ role: "viewer" }),
            route: "/drivers",
        });

        expect(
            await screen.findByRole("link", { name: "Alle 412 als Liste" }),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Neuer Fahrer" }),
        ).not.toBeInTheDocument();
    });

    it("switches to the table with „Alle als Liste“", async () => {
        renderAuth(<DriversPage />, {
            user: authUser(),
            route: "/drivers",
        });

        fireEvent.click(
            await screen.findByRole("link", { name: "Alle 412 als Liste" }),
        );

        expect(
            await screen.findByRole("table", { name: "Fahrerliste" }),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole("region", { name: "Gespräch führen" }),
        ).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: "← Übersicht" })).toHaveAttribute(
            "href",
            "/drivers",
        );
    });

    it("shows the board filter above the table", async () => {
        renderAuth(<DriversPage />, {
            user: authUser(),
            route: "/drivers?min_open_warnings=5&ansicht=liste",
        });

        expect(
            await screen.findByRole("table", { name: "Fahrerliste" }),
        ).toBeInTheDocument();
        expect(
            screen.getByText("Gefiltert: ab 5 offenen Warnungen"),
        ).toBeInTheDocument();
        expect(listDrivers).toHaveBeenCalledWith(
            expect.objectContaining({ min_open_warnings: 5 }),
            expect.anything(),
        );
    });
});
