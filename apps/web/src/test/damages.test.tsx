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
}));

vi.mock("../api/workshop", () => ({
    createWorkshopVisit: vi.fn(),
    updateWorkshopVisit: vi.fn(),
    getWorkshopPlaces: vi.fn().mockResolvedValue({ data: [] }),
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
                description: "Spiegel rechts abgerissen",
                severity: "MEDIUM",
                drivable: false,
            }),
        );
        expect(onSaved).toHaveBeenCalledWith(
            damage(),
            "Schaden an K-SCH 9 gemeldet. Es ist nicht fahrbereit.",
        );
    });
});

describe("Hinweise with damages", () => {
    it("lists open damages; one in a stay names the stay instead of Bearbeiten", () => {
        const onEdit = vi.fn();
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
                />
            </MemoryRouter>,
        );

        expect(
            screen.getByText("Spiegel rechts abgerissen · nicht fahrbereit · 28.10.2026"),
        ).toBeInTheDocument();
        expect(screen.getByText("Termin am 03.11.2026")).toBeInTheDocument();
        expect(screen.queryByText(/Alter Kratzer/)).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
        expect(onEdit).toHaveBeenCalledWith(damage());
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

        fireEvent.change(screen.getByLabelText("Werkstatt", { selector: "input" }), {
            target: { value: "Karosserie Schmitz" },
        });
        fireEvent.change(screen.getByLabelText("Termin am"), { target: { value: "2026-11-03" } });
        await screen.findByRole("option", { name: "Cihan Kurt (du)" });
        fireEvent.click(screen.getByRole("button", { name: "Termin planen" }));

        await waitFor(() =>
            expect(createWorkshopVisit).toHaveBeenCalledWith(
                9,
                expect.objectContaining({ reason: "DAMAGE", damage_ids: [7] }),
            ),
        );
    });
});
