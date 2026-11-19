import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { DueCounts, TodayItem, TodayResponse, WeekItem } from "@fleet-live/shared";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShiftPlan } from "../components/briefing/ShiftPlan";
import { VehiclesContext, type VehiclesContextValue } from "../context/vehiclesContext";
import { authUser, renderAuth } from "./renderAuth";

vi.mock("../api/today", () => ({ getToday: vi.fn() }));
vi.mock("../api/vehicles", () => ({ getVehicle: vi.fn() }));
vi.mock("../api/drivers", () => ({ getDriver: vi.fn(), setDriverCurrentVehicle: vi.fn(), listDrivers: vi.fn() }));
vi.mock("../api/sites", () => ({ listSites: vi.fn().mockResolvedValue({ data: [] }) }));

import { setDriverCurrentVehicle } from "../api/drivers";
import { getToday } from "../api/today";

const empty: Omit<TodayItem, "kind" | "key" | "subject"> = {
    vehicle_id: null,
    driver_id: null,
    due_kind: null,
    due_on: null,
    alert_id: null,
    since: null,
    workshop: null,
    workshop_task: null,
    workshop_place: null,
    damage: null,
    vehicle_plate: null,
    vehicle_driving: null,
    driver_name: null,
    phone: null,
    stay: null,
    trips_since: null,
    km_since: null,
    replacement: null,
};

const hu = (plate: string, driving: boolean, index: number): TodayItem => ({
    ...empty,
    kind: "deadline_overdue",
    key: `hu:${index}`,
    vehicle_id: 10 + index,
    subject: plate,
    due_kind: "hu",
    due_on: "2026-04",
    vehicle_driving: driving,
    driver_name: `Fahrer ${index}`,
});

const check = (name: string, plate: string, date: string): WeekItem => ({
    key: `check:${name}`,
    kind: "licence_check",
    due_on: date,
    vehicle_id: 4,
    driver_id: name.length,
    subject: name,
    vehicle_plate: plate,
    driver_name: null,
    vehicle_driving: false,
    stay: null,
});

// Friday 13.11.2026: the weekend belongs to today.
const response: TodayResponse = {
    data: {
        groups: [
            {
                kind: "licence_driving",
                count: 1,
                items: [
                    {
                        ...empty,
                        kind: "licence_driving",
                        key: "max",
                        vehicle_id: 1,
                        driver_id: 5,
                        subject: "Max Schulz",
                        due_kind: "licence_expiry",
                        due_on: "2026-11-06",
                        vehicle_plate: "K-ZE 470",
                        vehicle_driving: false,
                        trips_since: 6,
                        km_since: 985,
                        replacement: { id: 9, name: "Piotr Koch" },
                    },
                ],
            },
            {
                kind: "deadline_overdue",
                count: 3,
                items: [hu("K-JH 9331", true, 1), hu("K-GC 1877", false, 2), hu("K-SA 8800", false, 3)],
            },
            {
                kind: "offline",
                count: 1,
                items: [{ ...empty, kind: "offline", key: "off", vehicle_id: 2, subject: "D-CL 3102", since: "2026-10-27 12:24:01", driver_name: "Clara Rossi", phone: "+49 176 6431177" }],
            },
            {
                kind: "licence_ending",
                count: 1,
                items: [{ ...empty, kind: "licence_ending", key: "tom", vehicle_id: 3, driver_id: 6, subject: "Tom Demir", due_kind: "licence_expiry", due_on: "2026-11-14", vehicle_plate: "K-WB 8015" }],
            },
        ],
        week: [
            { date: "2026-11-16", count: 1, items: [check("Olga Schmitt", "K-UE 9390", "2026-11-16")] },
            { date: "2026-11-18", count: 1, items: [{ key: "u", kind: "uvv", due_on: "2026-11-18", vehicle_id: 8, driver_id: null, subject: "K-VA 5048", vehicle_plate: null, driver_name: "Sara Hartmann", vehicle_driving: false, stay: null }] },
        ],
    },
    meta: {
        today: "2026-11-13",
        ending_until: "2026-11-15",
        next_workday: "2026-11-16",
        counts: {
            licence_driving: 1,
            deadline_overdue: 3,
            workshop_due: 0,
            damage_unplanned: 0,
            offline: 1,
            check_overdue: 0,
            date_missing: 0,
            licence_ending: 1,
            deadline_ending: 0,
        },
        total: 6,
        week_until: "2026-12-15",
        week_total: 2,
        lead_days: 30,
    },
};

const due: DueCounts = { overdue: 17, soon: 77, missing: { hu: 2, uvv: 2, licence_expiry: 2 } };

const vehicles = {
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

const renderPlan = (role: "dispatcher" | "viewer" = "dispatcher", companyEmpty = false) =>
    renderAuth(
        <VehiclesContext.Provider value={vehicles}>
            <Routes>
                <Route path="/" element={<ShiftPlan due={due} leadDays={30} companyEmpty={companyEmpty} />} />
                <Route path="/vehicles/:id" element={<p>Fahrzeugseite</p>} />
                <Route path="/drivers/:id" element={<p>Fahrerseite</p>} />
            </Routes>
        </VehiclesContext.Provider>,
        { user: authUser({ role }), route: "/" },
    );

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
};

beforeEach(() => {
    vi.mocked(getToday).mockReset();
    vi.mocked(getToday).mockResolvedValue(response);
    vi.mocked(setDriverCurrentVehicle).mockReset();
});

describe("Schicht: Heute", () => {
    it("names who drove without a licence and offers the free replacement as the one filled button", async () => {
        renderPlan();

        const max = await screen.findByRole("link", { name: /Max Schulz/ });
        expect(within(max).getByText(/seit Ablauf 6 Fahrten, 985 km/)).toBeInTheDocument();
        const button = within(max).getByRole("button", { name: "Piotr Koch einteilen" });
        expect(button.className).toMatch(/primary/);

        vi.mocked(setDriverCurrentVehicle).mockResolvedValue({} as never);
        // A driver change asks first; nothing is written on the first click.
        fireEvent.click(button);
        expect(await screen.findByText("Piotr Koch auf K-ZE 470 einteilen?")).toBeInTheDocument();
        expect(setDriverCurrentVehicle).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Einteilen" }));
        await waitFor(() => expect(setDriverCurrentVehicle).toHaveBeenCalledWith(9, { vehicle_id: 1 }));
        expect(await screen.findByText("Piotr Koch fährt K-ZE 470, Max Schulz ist ohne Fahrzeug.")).toBeInTheDocument();
    });

    it("folds three of a kind into one row that opens inline", async () => {
        renderPlan();

        const toggle = await screen.findByRole("button", { name: "3 anzeigen" });
        expect(screen.getByText(/1 fahren gerade: K-JH 9331/)).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: /K-GC 1877/ })).toBeNull();

        fireEvent.click(toggle);
        const row = screen.getByRole("link", { name: /K-GC 1877/ });
        expect(within(row).getByRole("button", { name: "Termin planen" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Zuklappen" })).toHaveAttribute("aria-expanded", "true");
    });

    it("says on a Friday what runs out before Monday, and bridges to the tiles", async () => {
        renderPlan();

        expect(await screen.findByText(/Läuft vor Montag ab · 1/)).toBeInTheDocument();
        expect(screen.getByText("heute ist der letzte Werktag")).toBeInTheDocument();
        expect(screen.getByText("Aus den Kacheln: Überfällig 4 von 17 · Datum fehlt 0 von 6 · In 30 Tagen 1 von 77; was demnächst abläuft, steht rechts im Plan")).toBeInTheDocument();
        // Days without a signal: the step is to have the device checked, the driver's number is there.
        const offline = screen.getByRole("link", { name: /D-CL 3102/ });
        expect(within(offline).getByRole("button", { name: "Termin planen" })).toBeInTheDocument();
        expect(within(offline).getByText(/Tel\. \+49 176 6431177/)).toBeInTheDocument();
        // The red section says what it is, apart from the tile „Ausfall“.
        expect(screen.getByText("fährt ohne gültige Papiere oder fehlt im Einsatz")).toBeInTheDocument();
    });

    it("opens the driver from a licence row", async () => {
        renderPlan();

        fireEvent.click(await screen.findByRole("link", { name: /Tom Demir/ }));
        expect(await screen.findByText("Fahrerseite")).toBeInTheDocument();
    });

    it("shows a viewer the rows without actions", async () => {
        renderPlan("viewer");

        await screen.findByRole("link", { name: /Max Schulz/ });
        expect(screen.queryByRole("button", { name: "Piotr Koch einteilen" })).toBeNull();
        expect(screen.queryByText("Termin planen")).toBeNull();
    });
});

describe("Schicht: the plan", () => {
    it("lists only days that have something, each row with its step, and says where it ends", async () => {
        renderPlan();

        expect(await screen.findByRole("heading", { name: "Als Nächstes planen" })).toBeInTheDocument();
        expect(screen.getByText("2 bis Di 15.12.")).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Mo 16.11. · 1" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Mi 18.11. · 1" })).toBeInTheDocument();
        // No empty day: Tuesday has nothing and is not there.
        expect(screen.queryByRole("heading", { name: /Di 17.11./ })).toBeNull();
        const row = screen.getByRole("link", { name: /Olga Schmitt/ });
        expect(within(row).getByRole("button", { name: "Kontrolle eintragen" })).toBeInTheDocument();
        expect(screen.getByText(/1 HU\/UVV ohne Termin · 1 Kontrolle · Werkstatt-Termine: keiner geplant/)).toBeInTheDocument();
        expect(screen.getByText("Bis Di 15.12. läuft im Einsatz sonst nichts ab.")).toBeInTheDocument();
    });

    it("folds many of a kind on one day and points to the list when more exist than came along", async () => {
        const names = ["Deniz Krause", "Finn Hoffmann", "Erik Schulz", "Felix Becker"];
        vi.mocked(getToday).mockResolvedValue({
            ...response,
            data: { ...response.data, week: [{ date: "2026-11-19", count: 60, items: names.map((name) => check(name, "K-AA 1", "2026-11-19")) }] },
            meta: { ...response.meta, week_total: 60 },
        });
        renderPlan();

        const toggle = await screen.findByRole("button", { name: "4 anzeigen" });
        expect(screen.getByText("Deniz Krause, Finn Hoffmann, Erik Schulz, Felix Becker")).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: /Deniz Krause/ })).toBeNull();
        fireEvent.click(toggle);
        expect(screen.getByRole("link", { name: /Deniz Krause/ })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Weiter in den Fristen" })).toHaveAttribute("href", "/fristen?state=soon");
        expect(screen.getByText(/56 mehr an diesem Tag/)).toBeInTheDocument();
    });

    it("says in one line when nothing comes due", async () => {
        vi.mocked(getToday).mockResolvedValue({
            ...response,
            data: { ...response.data, week: [] },
            meta: { ...response.meta, week_total: 0 },
        });
        renderPlan();

        expect(await screen.findByText("Bis Di 15.12. läuft im Einsatz nichts ab.")).toBeInTheDocument();
        expect(screen.queryByText(/sonst nichts/)).toBeNull();
    });
});

describe("Schicht: nothing to do", () => {
    const calm: TodayResponse = {
        ...response,
        data: { ...response.data, groups: [] },
        meta: {
            ...response.meta,
            counts: Object.fromEntries(Object.keys(response.meta.counts).map((kind) => [kind, 0])) as TodayResponse["meta"]["counts"],
            total: 0,
        },
    };

    it("says nothing in use drives without permission and when the next item comes", async () => {
        vi.mocked(getToday).mockResolvedValue(calm);
        renderPlan();

        expect(await screen.findByText("Nichts im Einsatz fährt heute ohne Erlaubnis.")).toBeInTheDocument();
        expect(screen.getByText("Als Nächstes: Mo 16.11., 1 im Plan rechts.")).toBeInTheDocument();
    });

    it("says where tasks will come from in an empty company", async () => {
        vi.mocked(getToday).mockResolvedValue(calm);
        renderPlan("dispatcher", true);

        expect(await screen.findByText("Noch keine Aufgaben")).toBeInTheDocument();
        expect(screen.queryByText("Nichts im Einsatz fährt heute ohne Erlaubnis.")).toBeNull();
    });
});
