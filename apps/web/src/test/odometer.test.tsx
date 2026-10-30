import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { VehicleOdometer } from "@fleet-live/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OdometerDialog } from "../components/vehicles/OdometerDialog";
import { VehicleForm } from "../components/vehicles/VehicleForm";

vi.mock("../api/odometer", () => ({
    getVehicleOdometer: vi.fn(),
    correctVehicleOdometer: vi.fn(),
}));

vi.mock("../api/sites", () => ({
    listSites: vi.fn().mockResolvedValue({ data: [] }),
}));

import { correctVehicleOdometer, getVehicleOdometer } from "../api/odometer";

const odometer: VehicleOdometer = {
    km: 50000,
    readings: [
        {
            id: 2,
            km: 50000,
            previous_km: 12345,
            source: "MANUAL",
            note: "Werkstattrechnung",
            actor_name: "Cihan Kurt",
            created_at: "2026-10-30 09:00:00",
        },
        {
            id: 1,
            km: 12345,
            previous_km: null,
            source: "CREATE",
            note: null,
            actor_name: "Cihan Kurt",
            created_at: "2026-10-01 09:00:00",
        },
    ],
};

const vehicle = { id: 9, license_plate: "K-KM 9" };

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getVehicleOdometer).mockResolvedValue({ data: odometer });
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
        this.removeAttribute("open");
    };
});

describe("Kilometerstand", () => {
    it("shows the reading with its history and lets a dispatcher correct it", async () => {
        vi.mocked(correctVehicleOdometer).mockResolvedValue({ data: odometer });
        const onSaved = vi.fn();
        render(<OdometerDialog vehicle={vehicle} canWrite onClose={vi.fn()} onSaved={onSaved} />);

        expect(
            await screen.findByText("12.345 km → 50.000 km", { exact: false }),
        ).toBeInTheDocument();
        expect(screen.getByText(/Korrektur · Werkstattrechnung/)).toBeInTheDocument();
        expect(screen.getByText(/jetzt 50\.000 km/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
        expect(await screen.findByText("Stand laut Tacho fehlt.")).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText("Stand laut Tacho (km)"), {
            target: { value: "12a" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
        expect(await screen.findByText(/in ganzen Kilometern/)).toBeInTheDocument();
        expect(correctVehicleOdometer).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText("Stand laut Tacho (km)"), {
            target: { value: "51.200" },
        });
        fireEvent.change(screen.getByLabelText("Grund"), { target: { value: "Tacho abgelesen" } });
        fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

        await waitFor(() =>
            expect(correctVehicleOdometer).toHaveBeenCalledWith(9, {
                km: 51200,
                note: "Tacho abgelesen",
            }),
        );
        expect(onSaved).toHaveBeenCalledWith("Kilometerstand von K-KM 9 auf 51.200 km gesetzt.");
    });

    it("is read-only for a viewer", async () => {
        render(<OdometerDialog vehicle={vehicle} canWrite={false} onClose={vi.fn()} onSaved={vi.fn()} />);

        expect(await screen.findByText(/Beim Anlegen/)).toBeInTheDocument();
        expect(screen.queryByLabelText("Stand laut Tacho (km)")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Speichern" })).not.toBeInTheDocument();
    });

    it("is asked when a vehicle is created, not when it is edited", async () => {
        const onSubmit = vi.fn();
        const { unmount } = render(<VehicleForm submitLabel="Anlegen" onSubmit={onSubmit} />);

        fireEvent.change(screen.getByLabelText("Kennzeichen"), { target: { value: "K-NEU 1" } });
        fireEvent.change(screen.getByLabelText("Kilometerstand"), { target: { value: "8.400" } });
        fireEvent.click(screen.getByRole("button", { name: "Anlegen" }));

        await waitFor(() =>
            expect(onSubmit).toHaveBeenCalledWith(
                expect.objectContaining({ license_plate: "K-NEU 1", odometer_km: 8400 }),
            ),
        );
        unmount();

        render(
            <VehicleForm
                submitLabel="Speichern"
                initialValue={{ license_plate: "K-NEU 1", fuel_level: 50, status: "IDLE" }}
                onSubmit={vi.fn()}
            />,
        );
        expect(screen.queryByLabelText("Kilometerstand")).not.toBeInTheDocument();
    });
});
