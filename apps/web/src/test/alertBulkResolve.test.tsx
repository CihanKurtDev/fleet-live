import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
    type: "SPEEDING",
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
        counts: { all: data.length + 5, open: data.length, resolved: 5 },
        type_counts: {
            all: data.length,
            SPEEDING: 1,
            LOW_FUEL: 0,
            OFFLINE: data.length - 1,
        },
    },
});

const rows = [
    alert({ id: 1, driver_name: "Lisa Müller" }),
    alert({ id: 2 }),
    alert({ id: 3, vehicle_id: 2 }),
];

const refetchLists = vi.fn();
const onSelectAlert = vi.fn();

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

const renderTable = (canWrite: boolean, route = "/alerts") =>
    renderAuth(
        <VehiclesContext.Provider value={vehicles}>
            <AlertTable canWrite={canWrite} onSelectAlert={onSelectAlert} />
        </VehiclesContext.Provider>,
        { route },
    );

const rowCheckbox = (plate: string) =>
    screen.getByRole("checkbox", { name: new RegExp(`^Warnung ${plate},`) });

const startSelection = () =>
    fireEvent.click(screen.getByRole("button", { name: "Auswählen" }));

const lastQuery = () =>
    vi.mocked(listAlerts).mock.calls.at(-1)?.[0] as Parameters<
        typeof listAlerts
    >[0];

describe("alert list page", () => {
    beforeEach(() => {
        refetchLists.mockReset();
        onSelectAlert.mockReset();
        vi.mocked(listAlerts).mockReset();
        vi.mocked(listAlerts).mockResolvedValue(listResponse(rows));
        vi.mocked(resolveAlert).mockReset();
        vi.mocked(resolveAlerts).mockReset();
        vi.stubGlobal(
            "ResizeObserver",
            class {
                observe() {}
                disconnect() {}
            },
        );

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

    it("shows the situation sentence and tiles with one pressed", async () => {
        renderTable(true);

        expect(
            await screen.findByText("3 offen · 5 erledigt · neueste zuerst"),
        ).toBeInTheDocument();

        const tiles = screen.getByRole("group", { name: "Status" });
        const open = within(tiles).getByRole("button", { name: "Offen, 3" });
        const speeding = within(tiles).getByRole("button", {
            name: "Tempo, 1",
        });
        expect(
            within(tiles).getByRole("button", { name: "Funk, 2" }),
        ).toBeInTheDocument();
        expect(
            within(tiles).getByRole("button", { name: "Wenig Tank, 0" }),
        ).toBeInTheDocument();
        expect(
            within(tiles).getByRole("button", { name: "Erledigt, 5" }),
        ).toBeInTheDocument();
        expect(open).toHaveAttribute("aria-pressed", "true");

        fireEvent.click(speeding);

        await waitFor(() => expect(lastQuery().type).toBe("SPEEDING"));
        expect(lastQuery().filter).toBe("open");
        expect(speeding).toHaveAttribute("aria-pressed", "true");
        expect(
            within(tiles)
                .getAllByRole("button")
                .filter((tile) => tile.getAttribute("aria-pressed") === "true"),
        ).toHaveLength(1);
    });

    it("keeps the open type numbers on the tiles in the Erledigt view", async () => {
        renderTable(true);
        await screen.findByText("K-AB 1");

        // The API counts types for the status filter: resolved numbers here.
        const resolved = listResponse([
            alert({ id: 9, resolved_at: "2026-10-14 09:00:00" }),
        ]);
        vi.mocked(listAlerts).mockResolvedValue({
            ...resolved,
            meta: {
                ...resolved.meta,
                counts: { all: 8, open: 3, resolved: 5 },
                type_counts: { all: 5, SPEEDING: 5, LOW_FUEL: 0, OFFLINE: 0 },
            },
        });

        fireEvent.click(screen.getByRole("button", { name: "Erledigt, 5" }));

        await waitFor(() => expect(lastQuery().filter).toBe("resolved"));
        await screen.findByText("K-AB 9");
        expect(
            screen.getByRole("button", { name: "Tempo, 1" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Erledigt, 5" }),
        ).toHaveAttribute("aria-pressed", "true");
        // Resolved rows have no row button and no selection mode.
        expect(screen.queryByRole("button", { name: "Erledigen" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Auswählen" })).toBeNull();
    });

    it("lists plate with driver, type and event without a Schwere column", async () => {
        renderTable(true);
        await screen.findByText("K-AB 1");

        expect(screen.getByText("Lisa Müller")).toBeInTheDocument();
        expect(screen.getAllByText("Funk").length).toBeGreaterThan(0);
        expect(screen.queryByText("Schwere")).toBeNull();
        expect(
            screen.getByRole("button", { name: /^Zeitpunkt, absteigend/ }),
        ).toBeInTheDocument();
    });

    it("opens the alert's vehicle on a row click", async () => {
        renderTable(true);

        fireEvent.click(await screen.findByText("K-AB 2"));

        expect(onSelectAlert).toHaveBeenCalledWith(
            expect.objectContaining({ id: 2 }),
        );
    });

    it("shows no checkboxes until Auswählen is pressed", async () => {
        renderTable(true);
        await screen.findByText("K-AB 1");

        expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
        expect(screen.queryByRole("region", { name: "Auswahl" })).toBeNull();
        expect(
            screen.getAllByRole("button", { name: "Erledigen" }),
        ).toHaveLength(3);
    });

    it("selects by row click in selection mode and resolves after confirm", async () => {
        vi.mocked(resolveAlerts).mockResolvedValue({ data: { resolved: 2 } });
        renderTable(true);
        await screen.findByText("K-AB 1");

        startSelection();

        // Row buttons are hidden, a row click toggles instead of opening.
        expect(screen.queryByRole("button", { name: "Erledigen" })).toBeNull();
        const bar = screen.getByRole("region", { name: "Auswahl" });
        expect(within(bar).getByText("0 ausgewählt")).toBeInTheDocument();

        fireEvent.click(screen.getByText("K-AB 1"));
        fireEvent.click(rowCheckbox("K-AB 3"));
        expect(onSelectAlert).not.toHaveBeenCalled();

        expect(within(bar).getByText("2 ausgewählt")).toBeInTheDocument();
        expect(
            within(bar).getByText("alle Tempo · 2 Fahrzeuge"),
        ).toBeInTheDocument();

        const pageBox = within(bar).getByRole("checkbox", {
            name: "Alle auf dieser Seite auswählen",
        }) as HTMLInputElement;
        expect(pageBox.checked).toBe(false);
        expect(pageBox.indeterminate).toBe(true);

        fireEvent.click(within(bar).getByRole("button", { name: "2 erledigen" }));

        const dialog = screen.getByRole("dialog", {
            name: "2 Warnungen erledigen?",
            hidden: true,
        });
        expect(
            within(dialog).getByText(/Sie verschwinden aus „Offen“/),
        ).toBeInTheDocument();
        const list = within(dialog).getByRole("list", {
            name: "Ausgewählte Warnungen",
            hidden: true,
        });
        expect(within(list).getByText("K-AB 1")).toBeInTheDocument();
        expect(within(list).getByText("K-AB 3")).toBeInTheDocument();
        expect(within(list).queryByText("K-AB 2")).toBeNull();

        fireEvent.click(
            within(dialog).getByRole("button", {
                name: "2 erledigen",
                hidden: true,
            }),
        );

        await waitFor(() =>
            expect(resolveAlerts).toHaveBeenCalledWith([1, 3]),
        );
        expect(
            await screen.findByText("2 Warnungen erledigt."),
        ).toHaveAttribute("role", "status");
        expect(refetchLists).toHaveBeenCalled();
        // The mode ends after a bulk resolve.
        expect(screen.queryByRole("region", { name: "Auswahl" })).toBeNull();
        expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    });

    it("selects every row on the page from the bar and ends with Abbrechen", async () => {
        renderTable(true);
        await screen.findByText("K-AB 1");
        startSelection();

        fireEvent.click(
            screen.getByRole("checkbox", {
                name: "Alle auf dieser Seite auswählen",
            }),
        );

        expect(screen.getByText("3 ausgewählt")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

        expect(screen.queryByText("3 ausgewählt")).toBeNull();
        expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    });

    it("ends selection mode with Escape", async () => {
        renderTable(true);
        await screen.findByText("K-AB 1");
        startSelection();
        expect(
            screen.getByRole("region", { name: "Auswahl" }),
        ).toBeInTheDocument();

        fireEvent.keyDown(document, { key: "Escape" });

        expect(screen.queryByRole("region", { name: "Auswahl" })).toBeNull();
        expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    });

    it("clears the selection on another page", async () => {
        const paged = listResponse(rows);
        vi.mocked(listAlerts).mockResolvedValue({
            ...paged,
            meta: { ...paged.meta, total: 30, pageCount: 3 },
        });
        renderTable(true);
        await screen.findByText("K-AB 1");
        startSelection();

        fireEvent.click(rowCheckbox("K-AB 1"));
        expect(screen.getByText("1 ausgewählt")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Nächste Seite" }));

        await waitFor(() =>
            expect(listAlerts).toHaveBeenLastCalledWith(
                expect.objectContaining({ page: 2 }),
                expect.anything(),
            ),
        );
        // The mode stays on, the selection is empty.
        expect(screen.getByText("0 ausgewählt")).toBeInTheDocument();
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
        startSelection();

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

    it("resolves one alert from the row button without opening the vehicle", async () => {
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
        expect(onSelectAlert).not.toHaveBeenCalled();
    });

    it("gives a viewer no actions, no selection mode and no row button", async () => {
        renderTable(false);
        await screen.findByText("K-AB 1");

        expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
        for (const name of ["Auswählen", "Erledigen", "Exportieren"]) {
            expect(screen.queryByRole("button", { name })).toBeNull();
        }
        expect(screen.queryByRole("searchbox")).toBeNull();
    });

    it("shows a failed request without the empty-list sentence", async () => {
        vi.mocked(listAlerts).mockRejectedValue(new ApiError("Testfehler", 500));
        renderTable(true);

        expect(await screen.findByText("Testfehler")).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Erneut versuchen" }),
        ).toBeInTheDocument();
        expect(screen.queryByText("Keine offenen Warnungen.")).toBeNull();
    });

    it("offers Filter aufheben on an empty filtered list", async () => {
        const empty = listResponse([]);
        vi.mocked(listAlerts).mockResolvedValue({
            ...empty,
            meta: {
                ...empty.meta,
                counts: { all: 5, open: 0, resolved: 5 },
                type_counts: { all: 0, SPEEDING: 0, LOW_FUEL: 0, OFFLINE: 0 },
            },
        });
        renderTable(true, "/alerts?type=SPEEDING");

        expect(
            await screen.findByText("Keine Warnungen passen zum Filter."),
        ).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Filter aufheben" }));

        await waitFor(() => expect(lastQuery().type).toBeUndefined());
    });
});
