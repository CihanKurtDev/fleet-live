import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Alert, AlertTypeCounts, Site, WorkshopPlace } from "@fleet-live/shared";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { FleetEventFeed } from "../components/alerts/FleetEventFeed";
import { fleetEventDetail } from "../components/alerts/fleetEvents";
import { DepotPanel } from "../components/vehicles/DepotPanel";
import { PlaceBoard } from "../components/vehicles/PlaceBoard";
import { depotAfterClick } from "../components/vehicles/depotDraft";
import {
    FleetKpiBand,
    type FleetKpiTile,
} from "../components/vehicles/FleetKpiBand";

const alert = (overrides: Partial<Alert> = {}): Alert => ({
    id: 1,
    vehicle_id: 7,
    driver_id: 3,
    license_plate: "HB-HV 0007",
    driver_name: "Lisa Müller",
    type: "SPEEDING",
    severity: "HIGH",
    message: "zu schnell",
    details: { limit_kmh: 100, max_speed_kmh: 138, duration_s: 21 },
    created_at: "2026-09-01 19:04:00",
    ended_at: null,
    resolved_at: null,
    resolution_note: null,
    trip_id: null,
    ...overrides,
});

const typeCounts: AlertTypeCounts = {
    all: 12,
    SPEEDING: 8,
    LOW_FUEL: 0,
    OFFLINE: 4,
};

const site = (overrides: Partial<Site> = {}): Site =>
    ({
        id: 1,
        name: "Köln",
        latitude: 50.94,
        longitude: 6.96,
        radius_m: 400,
        home_count: 38,
        home_status: { driving: 20, idle: 10, stopped: 7, offline: 1 },
        in_depot_count: 9,
        other_home_count: 0,
        ...overrides,
    }) as Site;

const workshop = (overrides: Partial<WorkshopPlace> = {}): WorkshopPlace => ({
    id: 5,
    name: "Prüfstelle Ost",
    address: null,
    phone: null,
    latitude: 50.95,
    longitude: 6.99,
    radius_m: 150,
    vehicles_here: 0,
    here: [],
    appointments: [],
    ...overrides,
});

describe("FleetKpiBand", () => {
    const tiles = (onToggle = vi.fn()): FleetKpiTile[] => [
        {
            key: "DRIVING",
            label: "Auf Fahrt",
            value: 1051,
            hint: "40 im Ausschnitt",
            tone: "positive",
            pressed: true,
            onToggle,
        },
        {
            key: "speeding",
            label: "Tempo jetzt",
            value: 4,
            hint: "laufende Überschreitungen",
            tone: "critical",
            pressed: false,
            onToggle,
        },
        {
            key: "low_fuel",
            label: "Wenig Tank",
            value: null,
            pressed: false,
            onToggle,
        },
    ];

    it("shows each count as a filter button with its pressed state", () => {
        const onToggle = vi.fn();
        render(<FleetKpiBand tiles={tiles(onToggle)} />);

        const group = screen.getByRole("group", { name: "Lage" });
        const driving = within(group).getByRole("button", {
            name: "Auf Fahrt, 1.051",
        });
        const speeding = within(group).getByRole("button", {
            name: "Tempo jetzt, 4",
        });

        expect(driving).toHaveAttribute("aria-pressed", "true");
        expect(driving).toHaveTextContent("40 im Ausschnitt");
        expect(speeding).toHaveAttribute("aria-pressed", "false");
        expect(
            within(group).getByRole("button", { name: "Wenig Tank, —" }),
        ).toBeInTheDocument();

        fireEvent.click(speeding);
        expect(onToggle).toHaveBeenCalledTimes(1);
    });
});

describe("fleetEventDetail", () => {
    it("says läuft for a running speeding event instead of a duration", () => {
        expect(fleetEventDetail(alert())).toBe(
            "138 km/h bei Limit 100 · läuft",
        );
    });

    it("keeps the inbox line for an ended event", () => {
        expect(
            fleetEventDetail(alert({ ended_at: "2026-09-01 19:04:21" })),
        ).toBe("138 km/h bei Limit 100 · 21 s");
    });

    it("marks a running radio silence", () => {
        expect(
            fleetEventDetail(
                alert({
                    type: "OFFLINE",
                    details: null,
                    message: "Fahrzeug sendet kein Signal.",
                }),
            ),
        ).toBe("Fahrzeug sendet kein Signal · läuft");
    });
});

describe("FleetEventFeed", () => {
    const renderFeed = (
        overrides: Partial<Parameters<typeof FleetEventFeed>[0]> = {},
    ) => {
        const props = {
            alerts: [
                alert(),
                alert({
                    id: 2,
                    vehicle_id: 9,
                    license_plate: "B-FP 0083",
                    driver_name: null,
                    type: "OFFLINE",
                    details: null,
                    message: "Fahrzeug sendet kein Signal.",
                    ended_at: "2026-09-01 19:02:00",
                }),
            ],
            typeCounts,
            activeType: null,
            selectedVehicleId: null,
            isLoading: false,
            error: null,
            inboxHref: "/alerts?filter=all",
            onTypeChange: vi.fn(),
            onPick: vi.fn(),
            onRetry: vi.fn(),
            ...overrides,
        };

        render(
            <MemoryRouter>
                <FleetEventFeed {...props} />
            </MemoryRouter>,
        );

        return props;
    };

    it("lists the newest warnings with type, plate, detail and driver", () => {
        renderFeed();

        const rows = screen.getAllByRole("listitem");
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveTextContent("Tempo · HB-HV 0007");
        expect(rows[0]).toHaveTextContent(
            "138 km/h bei Limit 100 · läuft · Lisa Müller",
        );
        expect(rows[1]).toHaveTextContent("Kein Signal · B-FP 0083");
        expect(rows[1]).toHaveTextContent("Fahrzeug sendet kein Signal.");
        expect(
            screen.getByRole("link", { name: "Zu den Warnungen" }),
        ).toHaveAttribute("href", "/alerts?filter=all");
    });

    it("offers only types that have events and reports picks", () => {
        const props = renderFeed();
        const chips = screen.getByRole("group", { name: "Ereignistyp" });

        expect(
            within(chips).getByRole("button", { name: "Alle" }),
        ).toHaveAttribute("aria-pressed", "true");
        expect(
            within(chips).queryByRole("button", { name: "Tank" }),
        ).not.toBeInTheDocument();

        fireEvent.click(within(chips).getByRole("button", { name: "Kein Signal" }));
        expect(props.onTypeChange).toHaveBeenCalledWith("OFFLINE");

        fireEvent.click(screen.getByText("HB-HV 0007"));
        expect(props.onPick).toHaveBeenCalledWith(
            expect.objectContaining({ vehicle_id: 7 }),
        );
    });

    it("says so when there are no events", () => {
        renderFeed({ alerts: [], typeCounts: undefined });

        expect(screen.getByText("Keine Ereignisse.")).toBeInTheDocument();
    });
});

describe("depot selection", () => {
    it("clears the depot on a second click and keeps it while editing", () => {
        expect(depotAfterClick(undefined, 1, false)).toBe(1);
        expect(depotAfterClick(1, 1, false)).toBeNull();
        expect(depotAfterClick(1, 2, false)).toBe(2);
        expect(depotAfterClick(1, 1, true)).toBe(1);
    });

    const renderCard = (canEdit: boolean) => {
        const onDeselect = vi.fn();
        const onEdit = vi.fn();

        render(
            <MemoryRouter>
                <DepotPanel
                    sites={[site(), site({ id: 2, name: "Bremen" })]}
                    selectedId={1}
                    draft={null}
                    placing={false}
                    canEdit={canEdit}
                    saveError={null}
                    loadError={null}
                    isSaving={false}
                    onDeselect={onDeselect}
                    onEdit={onEdit}
                    onCancel={vi.fn()}
                    onDraftChange={vi.fn()}
                    onSave={vi.fn()}
                    onAskDelete={vi.fn()}
                    onRetryLoad={vi.fn()}
                />
            </MemoryRouter>,
        );

        return { onDeselect, onEdit };
    };

    it("shows the selected depot as a card with its vehicles by status", () => {
        const { onDeselect } = renderCard(false);
        const card = screen.getByRole("region", { name: "Depot Köln" });

        expect(card).toHaveTextContent("Stammstandort von 38 Fahrzeugen");
        expect(card).toHaveTextContent("Auf Fahrt20");
        expect(card).toHaveTextContent("Kein Signal1");
        expect(card).toHaveTextContent("Jetzt im Depot: 9");
        expect(within(card).queryByRole("button", { name: "Bearbeiten" })).not.toBeInTheDocument();

        fireEvent.click(within(card).getByRole("button", { name: "Auswahl aufheben" }));
        expect(onDeselect).toHaveBeenCalledTimes(1);
    });

    it("lets a dispatcher edit the depot from its card", () => {
        const { onEdit } = renderCard(true);

        fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
        expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    });
});

describe("PlaceBoard", () => {
    const view = { west: 6.9, south: 50.9, east: 7.0, north: 51.0 };
    const renderBoard = (canEdit: boolean) => {
        const props = {
            onSelect: vi.fn(),
            onOpenList: vi.fn(),
            onNewDepot: vi.fn(),
            onNewWorkshop: vi.fn(),
        };

        render(
            <PlaceBoard
                sites={[
                    site(),
                    site({ id: 2, name: "Bremen", latitude: 53.08, longitude: 8.8, home_count: 5, in_depot_count: 0 }),
                ]}
                workshops={[
                    workshop({
                        vehicles_here: 1,
                        here: [{ vehicle_id: 9, license_plate: "K-WS 1" }],
                        appointments: [
                            {
                                visit_id: 3,
                                vehicle_id: 8,
                                license_plate: "K-WS 2",
                                state: "PLANNED",
                                planned_on: "2026-11-03",
                                planned_time: null,
                                reasons: ["HU"],
                            },
                        ],
                    }),
                ]}
                view={view}
                selected={{ kind: "depot", id: 1 }}
                canEdit={canEdit}
                placing={false}
                loadError={null}
                onRetry={vi.fn()}
                {...props}
            />,
        );

        return props;
    };

    it("lists the places in view, busy ones first, and counts the rest", () => {
        const props = renderBoard(true);
        const board = screen.getByRole("region", { name: "Orte" });
        const tiles = within(board).getAllByRole("button", { pressed: undefined }).filter((button) =>
            button.hasAttribute("aria-pressed"),
        );

        // The workshop with a vehicle there comes before the depot; Bremen is outside.
        expect(tiles.map((tile) => tile.textContent)).toEqual([
            expect.stringContaining("Prüfstelle Ost"),
            expect.stringContaining("Köln"),
        ]);
        expect(tiles[0]).toHaveTextContent("K-WS 1 dort");
        expect(tiles[0]).toHaveTextContent("1 Termin · K-WS 2 am 03.11.");
        expect(tiles[1]).toHaveTextContent("10 Standby · 9 im Depot");
        expect(tiles[1]).toHaveAttribute("aria-pressed", "true");

        fireEvent.click(tiles[0]);
        expect(props.onSelect).toHaveBeenCalledWith({ kind: "workshop", id: 5 });

        fireEvent.click(within(board).getByRole("button", { name: "+ 1 außerhalb" }));
        fireEvent.click(within(board).getByRole("button", { name: /3\s*Orte/ }));
        expect(props.onOpenList).toHaveBeenCalledTimes(2);
        expect(within(board).getByRole("button", { name: /Neuer Ort/ })).toBeInTheDocument();
    });

    it("hides Neuer Ort for a viewer", () => {
        renderBoard(false);

        expect(screen.queryByRole("button", { name: /Neuer Ort/ })).not.toBeInTheDocument();
    });
});
