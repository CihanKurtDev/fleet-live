import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { VehicleOdometer } from "@fleet-live/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OdometerDialog } from "../components/vehicles/OdometerDialog";
import { OdometerNow } from "../components/vehicles/OdometerNow";
import { VehicleForm } from "../components/vehicles/VehicleForm";
import { VehiclesContext, type VehiclesContextValue } from "../context/vehiclesContext";

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
    reported_at: null,
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
    it("shows the counted reading with its history and lets a dispatcher correct it", async () => {
        vi.mocked(correctVehicleOdometer).mockResolvedValue({ data: odometer });
        const onSaved = vi.fn();
        render(<OdometerDialog vehicle={vehicle} canWrite onClose={vi.fn()} onSaved={onSaved} />);

        expect(
            await screen.findByText("12.345 km → 50.000 km", { exact: false }),
        ).toBeInTheDocument();
        expect(screen.getByText(/Korrektur · Werkstattrechnung/)).toBeInTheDocument();
        expect(screen.getByText(/jetzt ≈ 50\.000 km, aus der GPS-Strecke berechnet/)).toBeInTheDocument();

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
        fireEvent.change(screen.getByLabelText("Woher"), { target: { value: "Tacho abgelesen" } });
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

    it("shows a reading from the dashboard without a way to change it", async () => {
        vi.mocked(getVehicleOdometer).mockResolvedValue({
            data: { ...odometer, reported_at: "2026-10-30 09:00:00" },
        });
        render(<OdometerDialog vehicle={vehicle} canWrite onClose={vi.fn()} onSaved={vi.fn()} />);

        expect(await screen.findByText(/vom Fahrzeug gemeldet wie auf dem Tacho/)).toBeInTheDocument();
        expect(screen.queryByLabelText("Stand laut Tacho (km)")).not.toBeInTheDocument();
    });

    it("is not asked when a vehicle is created: it comes from the device or is entered once", () => {
        render(<VehicleForm submitLabel="Anlegen" onSubmit={vi.fn()} />);
        expect(screen.queryByLabelText("Kilometerstand")).not.toBeInTheDocument();
    });
});

describe("Kilometerstand unter Jetzt", () => {
    const context = {
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

    const renderNow = (
        target: { odometer_km: number | null; odometer_reported_at: string | null },
        canWrite = true,
    ) => {
        const onEdit = vi.fn();
        render(
            <VehiclesContext.Provider value={context}>
                <OdometerNow vehicle={{ id: 9, ...target }} canWrite={canWrite} onEdit={onEdit} />
            </VehiclesContext.Provider>,
        );
        return { onEdit };
    };

    it("says the dashboard reading comes from the vehicle and offers nothing to change", () => {
        renderNow({ odometer_km: 128431, odometer_reported_at: "2026-10-30 06:58:00" });

        expect(screen.getByText("128.431 km")).toBeInTheDocument();
        expect(screen.getByText(/vom Fahrzeug gemeldet, wie auf dem Tacho/)).toBeInTheDocument();
        expect(screen.queryByRole("button")).not.toBeInTheDocument();
        expect(getVehicleOdometer).not.toHaveBeenCalled();
    });

    it("marks a counted reading, names what it counts from and lets a dispatcher correct it", async () => {
        const { onEdit } = renderNow({ odometer_km: 52310, odometer_reported_at: null });

        expect(screen.getByText("≈ 52.310 km")).toBeInTheDocument();
        expect(
            await screen.findByText(/berechnet: 50\.000 km laut Werkstattrechnung .* plus die gefahrene Strecke/),
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Korrigieren" }));
        expect(onEdit).toHaveBeenCalled();
    });

    it("asks a dispatcher to enter the first reading of a GPS box", () => {
        const { onEdit } = renderNow({ odometer_km: null, odometer_reported_at: null });

        expect(screen.getByText(/Noch kein Stand vom Fahrzeug gemeldet. Einmal den Stand eintragen/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Stand vom Tacho eintragen" }));
        expect(onEdit).toHaveBeenCalled();
    });

    it("tells a viewer that no reading is entered yet", () => {
        renderNow({ odometer_km: null, odometer_reported_at: null }, false);

        expect(screen.getByText("Noch kein Stand vom Fahrzeug gemeldet oder eingetragen.")).toBeInTheDocument();
        expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
});
