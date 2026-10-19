import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Alert, AlertTypeCounts, Site } from "@fleet-live/shared";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { FleetEventFeed } from "../components/alerts/FleetEventFeed";
import { fleetEventDetail } from "../components/alerts/fleetEvents";
import { DepotPanel } from "../components/vehicles/DepotPanel";
import { DepotStrip } from "../components/vehicles/DepotStrip";
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
        in_depot_count: 9,
        other_home_count: 0,
        ...overrides,
    }) as Site;

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

    it("offers Auswahl aufheben on the selected depot", () => {
        const onDeselect = vi.fn();

        render(
            <MemoryRouter>
                <DepotPanel
                    sites={[site(), site({ id: 2, name: "Bremen" })]}
                    selectedId={1}
                    draft={null}
                    placing={false}
                    canEdit={false}
                    saveError={null}
                    loadError={null}
                    isSaving={false}
                    revealToken={0}
                    onSelect={vi.fn()}
                    onDeselect={onDeselect}
                    onEdit={vi.fn()}
                    onStartPlace={vi.fn()}
                    onCancel={vi.fn()}
                    onDraftChange={vi.fn()}
                    onSave={vi.fn()}
                    onAskDelete={vi.fn()}
                    onRetryLoad={vi.fn()}
                />
            </MemoryRouter>,
        );

        const buttons = screen.getAllByRole("button", {
            name: "Auswahl aufheben",
            hidden: true,
        });
        expect(buttons).toHaveLength(1);
        fireEvent.click(buttons[0]);
        expect(onDeselect).toHaveBeenCalledTimes(1);
    });
});

describe("DepotStrip", () => {
    const renderStrip = (canEdit: boolean) => {
        const onSelect = vi.fn();
        const onStartPlace = vi.fn();

        render(
            <DepotStrip
                sites={[site(), site({ id: 2, name: "Bremen", home_count: 5, in_depot_count: 0 })]}
                selectedId={2}
                canEdit={canEdit}
                placing={false}
                editing={false}
                loadError={null}
                onRetry={vi.fn()}
                onSelect={onSelect}
                onStartPlace={onStartPlace}
            />,
        );

        return { onSelect, onStartPlace };
    };

    it("shows who is in each depot and lets a dispatcher add one", () => {
        const { onSelect, onStartPlace } = renderStrip(true);
        const strip = screen.getByRole("region", { name: "Depots" });
        const koeln = within(strip).getByRole("button", { name: /Köln/ });

        expect(koeln).toHaveTextContent("9 im Depot · 38 Stammstandort");
        expect(koeln).toHaveAttribute("aria-pressed", "false");
        expect(
            within(strip).getByRole("button", { name: /Bremen/ }),
        ).toHaveAttribute("aria-pressed", "true");

        fireEvent.click(koeln);
        expect(onSelect).toHaveBeenCalledWith(
            expect.objectContaining({ id: 1 }),
        );

        fireEvent.click(
            within(strip).getByRole("button", { name: "Depot anlegen" }),
        );
        expect(onStartPlace).toHaveBeenCalledTimes(1);
    });

    it("hides Depot anlegen for a viewer", () => {
        renderStrip(false);

        expect(
            screen.queryByRole("button", { name: "Depot anlegen" }),
        ).not.toBeInTheDocument();
    });
});
