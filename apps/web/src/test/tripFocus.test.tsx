import type { Trip, TripEvent } from "@fleet-live/shared";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import L from "leaflet";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { TripFocus, type TripFocusInfo } from "../components/vehicles/TripFocus";

const points = [
    { lat: 50.0, lng: 7.0 },
    { lat: 50.1, lng: 7.0 },
    { lat: 50.2, lng: 7.0 },
];

const speeding = (overrides: Partial<TripEvent> = {}): TripEvent => ({
    id: 11,
    type: "SPEEDING",
    started_at: "2026-10-20 08:10:00",
    ended_at: "2026-10-20 08:11:00",
    from_m: 10_000,
    to_m: 14_000,
    max_speed_kmh: 92,
    limit_kmh: 50,
    estimated: false,
    count: 1,
    alert_id: 7,
    alert_open: true,
    ...overrides,
});

const trip = (overrides: Partial<Trip> = {}): Trip => ({
    id: 3,
    vehicle_id: 1,
    started_at: "2026-10-20 08:00:00",
    ended_at: "2026-10-20 09:00:00",
    point_count: 3,
    distance_m: 40_000,
    max_speed: 92,
    driver_id: 5,
    driver_name: "Erika Muster",
    speeding_count: 2,
    offline_count: 1,
    path: "",
    events: [],
    ...overrides,
});

const events = [
    speeding(),
    speeding({ id: 12, from_m: 30_000, to_m: 32_000, max_speed_kmh: 75, alert_id: 8 }),
    speeding({
        id: 13,
        type: "OFFLINE",
        from_m: 36_000,
        to_m: 36_000,
        max_speed_kmh: null,
        limit_kmh: null,
        alert_id: null,
        alert_open: false,
    }),
];

let map: L.Map | null = null;

beforeAll(() => {
    // jsdom has no layout: scrolling a row or the map into view does nothing.
    Element.prototype.scrollIntoView = vi.fn();
});

const renderFocus = (overrides: Partial<TripFocusInfo> = {}) => {
    const container = document.createElement("div");
    document.body.append(container);
    map = L.map(container).setView([50.1, 7.0], 10);
    const onFrame = vi.fn();
    const onBack = vi.fn();
    const onResolve = vi.fn().mockResolvedValue(undefined);

    render(
        <MemoryRouter>
            <TripFocus
                mapRef={{ current: map }}
                points={points}
                focus={{
                    trip: trip(),
                    events,
                    canResolve: true,
                    onResolve,
                    ...overrides,
                }}
                onFrame={onFrame}
                onBack={onBack}
            />
        </MemoryRouter>,
    );

    return { onFrame, onBack, onResolve };
};

afterEach(() => {
    map?.remove();
    map = null;
    document.body.innerHTML = "";
});

describe("trip focus", () => {
    it("frames the trip once and leads back to the vehicle", () => {
        const { onFrame, onBack } = renderFocus();

        expect(onFrame).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole("button", { name: "Zurück zum Fahrzeug" }));
        expect(onBack).toHaveBeenCalledOnce();
    });

    it("says who drove, how far, how fast, and lists what happened in order", () => {
        renderFocus();
        const panel = screen.getByRole("complementary", { name: "Ausgewählte Fahrt" });

        expect(within(panel).getByRole("link", { name: "Erika Muster" })).toHaveAttribute(
            "href",
            "/drivers/5",
        );
        // Distance in the facts, and again at the end (B) of the timeline.
        expect(within(panel).getAllByText("40,0 km")).toHaveLength(2);
        expect(within(panel).getByText(/^2× · 2\sMin\.$/)).toBeInTheDocument();

        const rows = within(panel).getAllByRole("button", { pressed: false });
        expect(rows).toHaveLength(3);
        expect(rows[0]).toHaveTextContent("+42 km/h");
        expect(rows[0]).toHaveTextContent("km 10,0–14,0");
        expect(rows[2]).toHaveTextContent("Fahrzeug sendete kein Signal");
        // One red stretch per finished run, one numbered marker per event.
        expect(document.querySelectorAll("path[class*='speeding']")).toHaveLength(2);
        expect(document.querySelectorAll("[class*='eventMarker']")).toHaveLength(3);
    });

    it("shows an event on the map and moves the replay there", () => {
        const { onFrame } = renderFocus();
        const panel = screen.getByRole("complementary", { name: "Ausgewählte Fahrt" });
        const second = within(panel).getAllByRole("button", { pressed: false })[1]!;

        fireEvent.click(second);

        expect(second).toHaveAttribute("aria-pressed", "true");
        expect(onFrame).toHaveBeenCalledTimes(2);
        expect(onFrame.mock.lastCall?.[2]).toBe(15);
        expect(screen.getByRole("slider", { name: "Stelle in der Fahrt" })).toHaveValue("750");
        expect(screen.getByText(/zu schnell · km 30,0 von 40,0/)).toBeInTheDocument();
        expect(document.querySelector("[class*='eventMarker'][data-selected]")).toHaveTextContent("2");
    });

    it("resolves all open warnings of the trip for a dispatcher", async () => {
        const { onResolve } = renderFocus();

        expect(screen.getByText("2 Tempo-Warnungen offen")).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "Erledigen" }));
        });

        expect(onResolve).toHaveBeenCalledWith([7, 8]);
        expect(screen.getByRole("status")).toHaveTextContent("2 Tempo-Warnungen erledigt.");
    });

    it("shows a viewer the warning without the action", () => {
        renderFocus({ canResolve: false });

        expect(screen.getByText("2 Tempo-Warnungen offen")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Erledigen" })).not.toBeInTheDocument();
    });

    it("plays, pauses and changes the speed", async () => {
        renderFocus({ events: [] });

        const play = screen.getByRole("button", { name: /Abspielen/ });
        fireEvent.click(play);
        expect(play).toHaveAccessibleName(/Pause/);

        await act(() => new Promise((resolve) => setTimeout(resolve, 80)));
        expect(screen.getByRole("slider")).not.toHaveValue("0");

        fireEvent.click(play);
        expect(play).toHaveAccessibleName(/Weiter/);

        fireEvent.click(screen.getByRole("button", { name: "16×" }));
        expect(screen.getByRole("button", { name: "16×" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByText(/Keine Verstöße auf dieser Fahrt/)).toBeInTheDocument();
    });

    it("frames a running trip without an end and without the replay", () => {
        renderFocus({ trip: trip({ ended_at: null }), events: [] });

        expect(screen.queryByRole("button", { name: /Abspielen/ })).not.toBeInTheDocument();
        expect(screen.getByText(/Die Fahrt läuft noch/)).toBeInTheDocument();
        expect(document.querySelector("[data-end='B']")).toBeNull();
    });
});
