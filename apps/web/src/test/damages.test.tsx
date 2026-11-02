import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { berlinTodayIso, type Damage, type Vehicle } from "@fleet-live/shared";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VehicleHintsPanel } from "../components/alerts/VehicleHintsPanel";
import { DamageDialog } from "../components/vehicles/DamageDialog";
import { WorkshopPlanDialog } from "../components/vehicles/WorkshopPlanDialog";
import { authUser, renderAuth } from "./renderAuth";

vi.mock("../api/damages", () => ({
    listVehicleDamages: vi.fn(),
    reportDamage: vi.fn(),
    updateDamage: vi.fn(),
    closeDamage: vi.fn(),
    addDamagePhoto: vi.fn(),
    deleteDamagePhoto: vi.fn(),
    damagePhotoUrl: (damageId: number, photoId: number) => `/api/damages/${damageId}/photos/${photoId}`,
}));

vi.mock("../api/sim", () => ({
    listSimRoutes: vi.fn().mockResolvedValue({ data: [] }),
}));

vi.mock("../context/vehiclesContext", () => ({
    useVehicles: () => ({ listEpoch: 0 }),
}));

vi.mock("../hooks/useDueSettings", () => ({
    useDueSettings: () => ({ settings: { lead_days: 30, check_months: 6 } }),
}));

vi.mock("../api/workshop", () => ({
    createWorkshopVisit: vi.fn(),
    updateWorkshopVisit: vi.fn(),
    getWorkshopBringers: vi.fn().mockResolvedValue({ data: [] }),
    getWorkshopPlaces: vi.fn().mockResolvedValue({
        data: [{ id: 3, name: "Karosserie Schmitz", address: null, phone: null, latitude: 50.9, longitude: 6.9, radius_m: 150, vehicles_here: 0, here: [], appointments: [] }],
    }),
}));

vi.mock("../api/drivers", () => ({
    listDrivers: vi.fn().mockResolvedValue({ data: [] }),
}));

vi.mock("../api/auth", () => ({
    listMembers: vi.fn().mockResolvedValue({
        data: [{ user_id: 1, name: "Cihan Kurt", email: "c@example.com", role: "dispatcher", invited: false }],
    }),
}));

import { listVehicleDamages, reportDamage } from "../api/damages";
import { createWorkshopVisit } from "../api/workshop";

const damage = (overrides: Partial<Damage> = {}): Damage => ({
    id: 7,
    vehicle_id: 9,
    occurred_on: "2026-10-28",
    description: "Spiegel rechts abgerissen",
    severity: "MEDIUM",
    drivable: false,
    state: "OPEN",
    workshop_visit_id: null,
    workshop_state: null,
    workshop_planned_on: null,
    closed_on: null,
    reported_by_name: "Cihan Kurt",
    created_at: "2026-10-28 09:00:00",
    occurred_time: null,
    latitude: null,
    longitude: null,
    driver_id: null,
    driver_name: null,
    photo_ids: [],
    ...overrides,
});

const vehicle = {
    id: 9,
    license_plate: "K-SCH 9",
    fuel_level: 60,
    status: "IDLE",
    hu_due_on: "2099-01",
    uvv_checked_on: "2026-09-01",
    uvv_due_on: null,
    open_alert_types: [],
    workshop: null,
} as unknown as Vehicle;

beforeEach(() => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
        this.removeAttribute("open");
    };
});

describe("Schaden melden", () => {
    it("reports a damage that takes the vehicle off the road", async () => {
        vi.mocked(reportDamage).mockResolvedValue({ data: damage() });
        const onSaved = vi.fn();
        renderAuth(
            <DamageDialog
                target={{ vehicleId: 9, licensePlate: "K-SCH 9" }}
                licensePlate="K-SCH 9"
                onClose={vi.fn()}
                onSaved={onSaved}
            />,
            { user: authUser() },
        );

        fireEvent.click(screen.getByRole("button", { name: "Schaden melden" }));
        expect(await screen.findByText("Was ist passiert? fehlt.")).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText("Was ist passiert?"), {
            target: { value: "Spiegel rechts abgerissen" },
        });
        fireEvent.click(screen.getByLabelText("mittel"));
        fireEvent.click(screen.getByLabelText("Nein"));
        expect(
            screen.getByText("Das Fahrzeug bekommt keinen Fahrer mehr, bis der Schaden behoben ist."),
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Schaden melden" }));

        await waitFor(() =>
            expect(reportDamage).toHaveBeenCalledWith(9, {
                occurred_on: berlinTodayIso(),
                occurred_time: expect.stringMatching(/^\d{2}:\d{2}$/),
                description: "Spiegel rechts abgerissen",
                severity: "MEDIUM",
                drivable: false,
                latitude: null,
                longitude: null,
            }),
        );
        expect(onSaved).toHaveBeenCalledWith(
            damage(),
            "Schaden an K-SCH 9 gemeldet. Es ist nicht fahrbereit.",
        );
    });
});

describe("Panne unterwegs", () => {
    it("says what a breakdown does and sends where it happened and who drove", async () => {
        vi.mocked(reportDamage).mockResolvedValue({ data: damage() });
        const onSaved = vi.fn();
        renderAuth(
            <DamageDialog
                target={{
                    vehicleId: 9,
                    licensePlate: "K-SCH 9",
                    driving: true,
                    driverName: "Sam Nowak",
                    position: { latitude: 50.9582, longitude: 6.9287 },
                }}
                licensePlate="K-SCH 9"
                onClose={vi.fn()}
                onSaved={onSaved}
            />,
            { user: authUser() },
        );

        expect(screen.getByText("K-SCH 9 · auf Fahrt mit Sam Nowak")).toBeInTheDocument();
        expect(screen.getByText("Sam Nowak", { selector: "p" })).toBeInTheDocument();
        expect(screen.getByText(/Letzte Meldung 50,9582° N · 6,9287° O/)).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText("Was ist passiert?"), { target: { value: "Reifen geplatzt" } });
        fireEvent.click(screen.getByLabelText("Nein"));
        expect(screen.getByText(/Panne unterwegs: K-SCH 9 hält an, die laufende Fahrt endet hier/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Schaden melden" }));

        await waitFor(() =>
            expect(reportDamage).toHaveBeenCalledWith(
                9,
                expect.objectContaining({ drivable: false, latitude: 50.9582, longitude: 6.9287 }),
            ),
        );
        expect(onSaved).toHaveBeenCalledWith(
            damage(),
            "Panne an K-SCH 9 gemeldet. Die Fahrt ist beendet, es ist nicht fahrbereit.",
        );
    });

    it("can leave the place out", async () => {
        vi.mocked(reportDamage).mockResolvedValue({ data: damage() });
        renderAuth(
            <DamageDialog
                target={{ vehicleId: 9, licensePlate: "K-SCH 9", position: { latitude: 50.9, longitude: 6.9 } }}
                licensePlate="K-SCH 9"
                onClose={vi.fn()}
                onSaved={vi.fn()}
            />,
            { user: authUser() },
        );

        fireEvent.change(screen.getByLabelText("Was ist passiert?"), { target: { value: "Kratzer" } });
        fireEvent.click(screen.getByRole("button", { name: "Ohne Ort" }));
        expect(screen.getByText(/Kein Ort eingetragen/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Schaden melden" }));

        await waitFor(() =>
            expect(reportDamage).toHaveBeenLastCalledWith(9, expect.objectContaining({ latitude: null, longitude: null })),
        );
    });
});

describe("Schaden melden und Termin planen", () => {
    it("ticks planning for a damage the vehicle cannot be driven with and hands the damage on", async () => {
        vi.mocked(reportDamage).mockResolvedValue({ data: damage() });
        const onSaved = vi.fn();
        const onPlan = vi.fn();
        renderAuth(
            <DamageDialog
                target={{ vehicleId: 9, licensePlate: "K-SCH 9" }}
                licensePlate="K-SCH 9"
                onClose={vi.fn()}
                onSaved={onSaved}
                onPlan={onPlan}
            />,
            { user: authUser() },
        );

        fireEvent.change(screen.getByLabelText("Was ist passiert?"), {
            target: { value: "Spiegel rechts abgerissen" },
        });
        const plan = screen.getByRole("checkbox", { name: "Danach Werkstatt-Termin planen" });
        expect(plan).not.toBeChecked();
        fireEvent.click(screen.getByLabelText("Nein"));
        expect(plan).toBeChecked();
        fireEvent.click(screen.getByRole("button", { name: "Melden und Termin planen" }));

        await waitFor(() =>
            expect(onPlan).toHaveBeenCalledWith(damage(), "Schaden an K-SCH 9 gemeldet. Es ist nicht fahrbereit."),
        );
        expect(onSaved).not.toHaveBeenCalled();
    });
});

describe("Hinweise with damages", () => {
    it("lists open damages: the text opens one, Termin planen plans it, one in a stay names the stay", () => {
        const onEdit = vi.fn();
        const onPlan = vi.fn();
        render(
            <MemoryRouter>
                <VehicleHintsPanel
                    vehicle={vehicle}
                    canWrite
                    damages={[
                        damage(),
                        damage({
                            id: 8,
                            description: "Delle Heckklappe",
                            drivable: true,
                            workshop_visit_id: 3,
                            workshop_state: "PLANNED",
                            workshop_planned_on: "2026-11-03",
                        }),
                        damage({ id: 9, description: "Alter Kratzer", state: "CLOSED" }),
                    ]}
                    onEditDamage={onEdit}
                    onPlanWorkshop={onPlan}
                />
            </MemoryRouter>,
        );

        expect(screen.getByText(/Termin am 03\.11\.2026/)).toBeInTheDocument();
        expect(screen.queryByText(/Alter Kratzer/)).not.toBeInTheDocument();

        fireEvent.click(
            screen.getByRole("button", { name: "Spiegel rechts abgerissen · nicht fahrbereit · 28.10.2026" }),
        );
        expect(onEdit).toHaveBeenCalledWith(damage());

        // One row button: the damage in a stay has none.
        fireEvent.click(screen.getByRole("button", { name: "Termin planen" }));
        expect(onPlan).toHaveBeenCalledWith({ reason: "DAMAGE", damageId: damage().id });
    });
});

describe("Werkstatt-Termin für einen Schaden", () => {
    it("ticks the open damages for a stay with reason Schaden and sends them", async () => {
        vi.mocked(listVehicleDamages).mockResolvedValue({
            data: [damage(), damage({ id: 8, description: "Delle Heckklappe", drivable: true })],
        });
        vi.mocked(createWorkshopVisit).mockResolvedValue({ data: {} as never });
        renderAuth(
            <WorkshopPlanDialog
                target={{ vehicleId: 9, licensePlate: "K-SCH 9", reason: "DAMAGE" }}
                onClose={vi.fn()}
                onSaved={vi.fn()}
            />,
            { user: authUser() },
        );

        const first = await screen.findByRole("checkbox", { name: /Spiegel rechts abgerissen/ });
        expect(first).toBeChecked();
        fireEvent.click(screen.getByRole("checkbox", { name: /Delle Heckklappe/ }));

        await screen.findByRole("option", { name: "Karosserie Schmitz" });
        fireEvent.change(screen.getByRole("combobox", { name: "Werkstatt" }), { target: { value: "3" } });
        fireEvent.change(screen.getByLabelText("Termin am"), { target: { value: "2099-11-03" } });
        await screen.findByRole("option", { name: "Cihan Kurt (du)" });
        fireEvent.click(screen.getByRole("button", { name: "Termin planen" }));

        await waitFor(() =>
            expect(createWorkshopVisit).toHaveBeenCalledWith(
                9,
                expect.objectContaining({ reasons: ["DAMAGE"], workshop_id: 3, expected_on: "2099-11-03", damage_ids: [7] }),
            ),
        );
    });
});
