import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { FleetPosition, VehicleStatus } from "@fleet-live/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FleetPage } from "../pages/FleetPage";
import {
    VehiclesContext,
    type VehiclesContextValue,
} from "../context/vehiclesContext";
import { authUser, renderAuth } from "./renderAuth";

vi.mock("../hooks/useFleetPositions", () => ({ useFleetPositions: vi.fn() }));
vi.mock("../hooks/useBriefing", () => ({ useBriefing: vi.fn() }));
vi.mock("../hooks/useAlertList", () => ({ useAlertList: vi.fn() }));
vi.mock("../api/sites", () => ({
    listSites: vi.fn(),
    createSite: vi.fn(),
    updateSite: vi.fn(),
    deleteSite: vi.fn(),
}));
// Leaflet needs a real browser; the map is checked there. Here it only shows
// what the page hands to it.
vi.mock("../components/vehicles/FleetMap", () => ({
    FleetMap: ({
        vehicles,
        selectedId,
        onSelect,
    }: {
        vehicles: FleetPosition[];
        selectedId: number | null;
        onSelect: (id: number | null) => void;
    }) => (
        <div data-testid="map" data-selected={selectedId ?? ""}>
            {vehicles.map((vehicle) => (
                <button
                    key={vehicle.id}
                    type="button"
                    onClick={() => onSelect(vehicle.id)}
                >
                    {`dot ${vehicle.license_plate}`}
                </button>
            ))}
        </div>
    ),
}));
vi.mock("../components/vehicles/FleetDriverPicker", () => ({
    FleetDriverPicker: () => <div data-testid="driver-picker" />,
}));

import { useAlertList } from "../hooks/useAlertList";
import { useBriefing } from "../hooks/useBriefing";
import { useFleetPositions } from "../hooks/useFleetPositions";
import { listSites } from "../api/sites";

const position = (
    id: number,
    status: VehicleStatus,
    overrides: Partial<FleetPosition> = {},
): FleetPosition => ({
    id,
    license_plate: `K-FL ${id}`,
    driver_name: status === "DRIVING" ? `Fahrer ${id}` : null,
    status,
    has_position: true,
    latitude: 50.9 + id / 100,
    longitude: 6.9,
    speed: status === "DRIVING" ? 60 : 0,
    recorded_at: "2026-10-19 10:00:00",
    ...overrides,
});

const VEHICLES: FleetPosition[] = [
    position(1, "DRIVING"),
    position(2, "DRIVING"),
    position(3, "IDLE"),
    position(4, "STOPPED"),
    position(5, "OFFLINE"),
];

const context: VehiclesContextValue = {
    listEpoch: 0,
    vehicleOverrides: {},
    streamConnection: "live",
    lastTelemetryAt: null,
    refetchLists: vi.fn(),
    createVehicle: vi.fn(),
    updateVehicle: vi.fn(),
    deleteVehicles: vi.fn(),
    subscribeTripPath: () => () => undefined,
} as unknown as VehiclesContextValue;

const positionsResult = (vehicles: FleetPosition[]) => ({
    vehicles,
    densityCells: [],
    mode: "positions" as const,
    total: vehicles.length,
    matched: vehicles.length,
    withoutPosition: 0,
    isLoading: false,
    hasLoaded: true,
    error: null,
    retry: vi.fn(),
    snapshotLength: vehicles.length,
});

const renderPage = (route = "/fleet", role: "dispatcher" | "viewer" = "dispatcher") =>
    renderAuth(
        <VehiclesContext.Provider value={context}>
            <FleetPage />
        </VehiclesContext.Provider>,
        { user: authUser({ role }), route },
    );

beforeEach(() => {
    vi.mocked(useFleetPositions).mockReset();
    vi.mocked(useFleetPositions).mockReturnValue(positionsResult(VEHICLES) as never);
    vi.mocked(useBriefing).mockReturnValue({
        data: {
            counts: { speeding: 3, low_fuel: 9 },
        },
        isLoading: false,
        isFetching: false,
        error: null,
        retry: vi.fn(),
    } as never);
    vi.mocked(useAlertList).mockReturnValue({
        data: [],
        meta: undefined,
        isLoading: false,
        isFetching: false,
        error: null,
        retry: vi.fn(),
        notFound: false,
        pageCount: 1,
        total: 0,
    } as never);
    vi.mocked(listSites).mockResolvedValue({ data: [] } as never);
});

const band = () => screen.getByRole("group", { name: "Lage" });

describe("Flottenkarte", () => {
    it("shows the four status tiles with their fleet counts, and the two warning tiles", async () => {
        renderPage();

        await waitFor(() =>
            expect(
                within(band()).getByRole("button", {
                    name: /^Auf Fahrt, \d+ im Ausschnitt, 2 gesamt$/,
                }),
            ).toBeInTheDocument(),
        );
        expect(within(band()).getByRole("button", { name: /^Standby.*, 1 gesamt$/ })).toBeInTheDocument();
        expect(within(band()).getByRole("button", { name: /^Feierabend.*, 1 gesamt$/ })).toBeInTheDocument();
        expect(within(band()).getByRole("button", { name: /^Kein Signal.*, 1 gesamt$/ })).toBeInTheDocument();
        expect(within(band()).getByRole("button", { name: "Tempo jetzt, 3" })).toBeInTheDocument();
        expect(within(band()).getByRole("button", { name: "Wenig Tank, 9" })).toBeInTheDocument();
    });

    it("draws every vehicle, and only one status while its tile is pressed", async () => {
        renderPage();

        const map = await screen.findByTestId("map");
        expect(within(map).getAllByRole("button")).toHaveLength(5);

        const standby = within(band()).getByRole("button", { name: /^Standby/ });
        fireEvent.click(standby);

        expect(standby).toHaveAttribute("aria-pressed", "true");
        expect(within(map).getAllByRole("button")).toHaveLength(1);
        expect(within(map).getByText("dot K-FL 3")).toBeInTheDocument();

        // A second click on the same tile lifts the filter.
        fireEvent.click(standby);
        expect(standby).toHaveAttribute("aria-pressed", "false");
        expect(within(map).getAllByRole("button")).toHaveLength(5);
    });

    it("opens with the status chip of a link from Schicht and keeps the other filters out of the address", async () => {
        renderPage("/fleet?filter=offline");

        const map = await screen.findByTestId("map");
        await waitFor(() => expect(within(map).getAllByRole("button")).toHaveLength(1));
        expect(within(map).getByText("dot K-FL 5")).toBeInTheDocument();
        expect(within(band()).getByRole("button", { name: /^Kein Signal/ })).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        // The status is a chip in the page, not a server filter.
        expect(vi.mocked(useFleetPositions).mock.calls.at(-1)?.[0].filter).toBeUndefined();
    });

    it("asks the server for Wenig Tank and lifts it with a second click", async () => {
        renderPage();
        await screen.findByTestId("map");

        const tile = within(band()).getByRole("button", { name: "Wenig Tank, 9" });
        fireEvent.click(tile);

        await waitFor(() =>
            expect(vi.mocked(useFleetPositions).mock.calls.at(-1)?.[0].filter).toBe("low_fuel"),
        );
        expect(within(band()).getByRole("button", { name: "Wenig Tank, 9" })).toHaveAttribute(
            "aria-pressed",
            "true",
        );

        fireEvent.click(within(band()).getByRole("button", { name: "Wenig Tank, 9" }));
        await waitFor(() =>
            expect(vi.mocked(useFleetPositions).mock.calls.at(-1)?.[0].filter).toBeUndefined(),
        );
    });

    it("selects a vehicle from the map and shows it in the side panel", async () => {
        renderPage();

        fireEvent.click(await screen.findByText("dot K-FL 2"));

        await waitFor(() =>
            expect(screen.getByTestId("map")).toHaveAttribute("data-selected", "2"),
        );
        expect(screen.getAllByText("K-FL 2").length).toBeGreaterThan(0);
    });

    it("says why the map is empty when no vehicle has a position", async () => {
        vi.mocked(useFleetPositions).mockReturnValue(
            positionsResult([position(1, "IDLE", { has_position: false, latitude: null, longitude: null, speed: null, recorded_at: null })]) as never,
        );
        renderPage();

        await screen.findByTestId("map");
        expect(screen.getByText(/Position|position/)).toBeInTheDocument();
    });

    it("shows the error of the positions with a retry", async () => {
        const retry = vi.fn();
        vi.mocked(useFleetPositions).mockReturnValue({
            ...positionsResult([]),
            hasLoaded: false,
            error: "Positionen konnten nicht geladen werden.",
            retry,
        } as never);
        renderPage();

        expect(
            await screen.findByText("Positionen konnten nicht geladen werden."),
        ).toBeInTheDocument();
        fireEvent.click(screen.getAllByRole("button", { name: "Erneut versuchen" })[0]);
        expect(retry).toHaveBeenCalled();
    });
});
