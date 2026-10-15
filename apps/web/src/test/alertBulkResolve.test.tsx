import { fireEvent, screen, within } from "@testing-library/react";
import type { Alert, AlertListResponse } from "@fleet-live/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AlertTable } from "../components/alerts/AlertTable";
import {
    VehiclesContext,
    type VehiclesContextValue,
} from "../context/vehiclesContext";
import { ApiError } from "../api/client";
import { renderAuth } from "./renderAuth";

vi.mock("../api/alerts", () => ({
    listAlerts: vi.fn(),
    resolveAlert: vi.fn(),
    resolveAlerts: vi.fn(),
}));

import { listAlerts, resolveAlert, resolveAlerts } from "../api/alerts";

const alert = (overrides: Partial<Alert> & { id: number }): Alert => ({
    vehicle_id: overrides.id,
    driver_id: null,
    license_plate: `K-AB ${overrides.id}`,
    driver_name: null,
    type: "OFFLINE",
    severity: "MEDIUM",
    message: "Fahrzeug sendet kein Signal",
    details: null,
    created_at: "2026-10-14 08:00:00",
    ended_at: null,
    resolved_at: null,
    ...overrides,
});

const listResponse = (data: Alert[]): AlertListResponse => ({
    data,
    meta: {
        page: 1,
        limit: 10,
        total: data.length,
        pageCount: 1,
        counts: { all: data.length, open: data.length, resolved: 0 },
        type_counts: {
            all: data.length,
            SPEEDING: 0,
            LOW_FUEL: 0,
            OFFLINE: data.length,
        },
    },
});

const rows = [
    alert({ id: 1 }),
    alert({ id: 2 }),
    alert({ id: 3, vehicle_id: 2 }),
];

const refetchLists = vi.fn();

const vehicles = {
    listEpoch: 0,
    vehicleOverrides: {},
    streamConnection: "live",
    lastTelemetryAt: null,
    refetchLists,
    createVehicle: vi.fn(),
    updateVehicle: vi.fn(),
    deleteVehicles: vi.fn(),
    subscribeTripPath: vi.fn(() => () => undefined),
} satisfies VehiclesContextValue;

const renderTable = (canWrite: boolean) =>
    renderAuth(
        <VehiclesContext.Provider value={vehicles}>
            <AlertTable canWrite={canWrite} />
        </VehiclesContext.Provider>,
        { route: "/alerts" },
    );

const rowCheckbox = (plate: string) =>
    screen.getByRole("checkbox", { name: new RegExp(`^Warnung ${plate},`) });

describe("alert inbox bulk resolve", () => {
    beforeEach(() => {
        refetchLists.mockReset();
        vi.mocked(listAlerts).mockReset();
        vi.mocked(listAlerts).mockResolvedValue(listResponse(rows));
        vi.mocked(resolveAlert).mockReset();
        vi.mocked(resolveAlerts).mockReset();

        // jsdom kennt showModal/close nicht in jeder Version.
        HTMLDialogElement.prototype.showModal ??= function (
            this: HTMLDialogElement,
        ) {
            this.setAttribute("open", "");
        };
        HTMLDialogElement.prototype.close ??= function (
            this: HTMLDialogElement,
        ) {
            this.removeAttribute("open");
        };
    });

    it("shows a selection bar with the count and resolves after confirm", async () => {
        vi.mocked(resolveAlerts).mockResolvedValue({ data: { resolved: 2 } });
        renderTable(true);

        await screen.findByText("K-AB 1");
        expect(screen.queryByRole("region", { name: "Auswahl" })).toBeNull();

        fireEvent.click(rowCheckbox("K-AB 1"));
        fireEvent.click(rowCheckbox("K-AB 3"));

        const bar = screen.getByRole("region", { name: "Auswahl" });
        expect(within(bar).getByText("2 ausgewählt")).toBeInTheDocument();
        expect(within(bar).getByText("alle Funk · 2 Fahrzeuge")).toBeInTheDocument();

        const selectAll = screen.getByRole("checkbox", {
            name: "Alle auf dieser Seite",
        }) as HTMLInputElement;
        expect(selectAll.checked).toBe(false);
        expect(selectAll.indeterminate).toBe(true);

        fireEvent.click(within(bar).getByRole("button", { name: "2 erledigen" }));

        const dialog = screen.getByRole("dialog", {
            name: "2 Warnungen erledigen?",
            hidden: true,
        });
        expect(
            within(dialog).getByText(/Sie verschwinden aus „Offen“/),
        ).toBeInTheDocument();
        expect(within(dialog).getByText("K-AB 1")).toBeInTheDocument();
        expect(within(dialog).getByText("K-AB 3")).toBeInTheDocument();

        fireEvent.click(
            within(dialog).getByRole("button", {
                name: "2 erledigen",
                hidden: true,
            }),
        );

        expect(resolveAlerts).toHaveBeenCalledWith([1, 3]);
        expect(
            await screen.findByText("2 Warnungen erledigt."),
        ).toHaveAttribute("role", "status");
        expect(refetchLists).toHaveBeenCalled();
        expect(screen.queryByRole("region", { name: "Auswahl" })).toBeNull();
    });

    it("selects every open row on the page from the header", async () => {
        renderTable(true);
        await screen.findByText("K-AB 1");

        fireEvent.click(
            screen.getByRole("checkbox", { name: "Alle auf dieser Seite" }),
        );

        expect(screen.getByText("3 ausgewählt")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Auswahl aufheben" }));

        expect(screen.queryByText("3 ausgewählt")).toBeNull();
    });

    it("clears the selection on another page", async () => {
        const paged = listResponse(rows);
        vi.mocked(listAlerts).mockResolvedValue({
            ...paged,
            meta: { ...paged.meta, total: 30, pageCount: 3 },
        });
        renderTable(true);
        await screen.findByText("K-AB 1");

        fireEvent.click(rowCheckbox("K-AB 1"));
        expect(screen.getByText("1 ausgewählt")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Nächste Seite" }));

        await vi.waitFor(() =>
            expect(listAlerts).toHaveBeenLastCalledWith(
                expect.objectContaining({ page: 2 }),
                expect.anything(),
            ),
        );
        expect(screen.queryByText("1 ausgewählt")).toBeNull();
        expect((rowCheckbox("K-AB 1") as HTMLInputElement).checked).toBe(
            false,
        );
    });

    it("keeps the dialog open with the API error", async () => {
        vi.mocked(resolveAlerts).mockRejectedValue(
            new ApiError("Mindestens eine Warnung wurde nicht gefunden.", 404),
        );
        renderTable(true);
        await screen.findByText("K-AB 1");

        fireEvent.click(rowCheckbox("K-AB 2"));
        fireEvent.click(screen.getByRole("button", { name: "1 erledigen" }));

        const dialog = screen.getByRole("dialog", {
            name: "1 Warnung erledigen?",
            hidden: true,
        });
        fireEvent.click(
            within(dialog).getByRole("button", {
                name: "1 erledigen",
                hidden: true,
            }),
        );

        expect(
            await within(dialog).findByText(
                "Mindestens eine Warnung wurde nicht gefunden.",
            ),
        ).toBeInTheDocument();
        expect(screen.getByText("1 ausgewählt")).toBeInTheDocument();
    });

    it("confirms a single resolve with a short status", async () => {
        vi.mocked(resolveAlert).mockResolvedValue(
            alert({ id: 1, resolved_at: "2026-10-14 09:00:00" }),
        );
        renderTable(true);
        await screen.findByText("K-AB 1");

        fireEvent.click(screen.getAllByRole("button", { name: "Erledigen" })[0]);

        expect(resolveAlert).toHaveBeenCalledWith(1);
        expect(await screen.findByText("Warnung erledigt.")).toHaveAttribute(
            "role",
            "status",
        );
    });

    it("shows no checkboxes to a viewer", async () => {
        renderTable(false);
        await screen.findByText("K-AB 1");

        expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
        expect(screen.queryByRole("button", { name: "Erledigen" })).toBeNull();
    });
});
