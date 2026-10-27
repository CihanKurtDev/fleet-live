import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { DueKind, DueListItem, DueListResponse } from "@fleet-live/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DueBoard } from "../components/due/DueBoard";
import { renderAuth, authUser } from "./renderAuth";

vi.mock("../api/due", () => ({
    listDue: vi.fn(),
    getDueSettings: vi.fn(),
    updateDueSettings: vi.fn(),
}));

import { getDueSettings, listDue } from "../api/due";

const row = (
    kind: DueKind,
    label: string,
    overrides: Partial<DueListItem> = {},
): DueListItem => ({
    kind,
    state: "overdue",
    due_on: "2026-09-30",
    vehicle_id: kind === "hu" || kind === "uvv" ? 7 : null,
    driver_id: kind === "hu" || kind === "uvv" ? null : 3,
    label,
    ...overrides,
});

const ROWS: DueListItem[] = [
    row("licence_expiry", "Ali Arslan"),
    row("hu", "HB-HV 0007"),
    row("hu", "HB-KE 0036"),
    row("uvv", "HB-FN 1218"),
];

const response = (kind: DueKind | undefined): DueListResponse => {
    const data = kind ? ROWS.filter((item) => item.kind === kind) : ROWS;

    return {
        data,
        meta: {
            page: 1,
            limit: 25,
            total: data.length,
            pageCount: 1,
            counts: { overdue: 4, soon: 2, missing: 1 },
            kind_counts: {
                all: 4,
                hu: 2,
                uvv: 1,
                licence_expiry: 1,
                licence_check: 0,
            },
            lead_days: 30,
            licence_check_months: 6,
        },
    };
};

// jsdom has no layout: the lists are measured with ResizeObserver.
vi.stubGlobal(
    "ResizeObserver",
    class {
        observe() {}
        unobserve() {}
        disconnect() {}
    },
);

beforeEach(() => {
    vi.mocked(listDue).mockReset();
    vi.mocked(listDue).mockImplementation(async (query) => response(query.kind));
    vi.mocked(getDueSettings).mockReset();
    vi.mocked(getDueSettings).mockResolvedValue({
        data: { due_lead_days: null, licence_check_months: null, lead_days: 30, check_months: 6 },
    } as never);
});

const renderBoard = (route = "/fristen") =>
    renderAuth(<DueBoard />, { user: authUser(), route });

describe("Fristen board", () => {
    it("shows the three state tiles with their counts", async () => {
        renderBoard();

        const tiles = await screen.findByRole("group", { name: "Stand" });
        await waitFor(() =>
            expect(within(tiles).getByRole("button", { name: "Überfällig, 4" })).toBeInTheDocument(),
        );
        expect(within(tiles).getByRole("button", { name: /^In 30 Tagen, 2$/ })).toBeInTheDocument();
        expect(within(tiles).getByRole("button", { name: "Datum fehlt, 1" })).toBeInTheDocument();
        // One state is always chosen.
        expect(within(tiles).getByRole("button", { name: "Überfällig, 4" })).toHaveAttribute(
            "aria-pressed",
            "true",
        );
    });

    it("groups the rows by kind in the overview", async () => {
        renderBoard();

        expect(await screen.findByText("HB-HV 0007")).toBeInTheDocument();
        expect(screen.getByText("HB-KE 0036")).toBeInTheDocument();
        expect(screen.getByText("Ali Arslan")).toBeInTheDocument();
        expect(screen.getByText("HB-FN 1218")).toBeInTheDocument();
    });

    it("asks for one kind when its chip is chosen and shows only that kind", async () => {
        renderBoard();
        await screen.findByText("HB-HV 0007");

        // The chips and the rail both carry the kind filter (CSS shows one).
        const chips = screen.getByRole("group", { name: "Art" });
        fireEvent.click(within(chips).getByRole("button", { name: /^HU\s*2$/ }));

        await waitFor(() =>
            expect(vi.mocked(listDue).mock.calls.some(([query]) => query.kind === "hu" && query.limit !== 10)).toBe(
                true,
            ),
        );
        await waitFor(() => expect(screen.queryByText("Ali Arslan")).toBeNull());
        expect(screen.getByText("HB-HV 0007")).toBeInTheDocument();
        expect(within(chips).getByRole("button", { name: /^HU\s*2$/ })).toHaveAttribute(
            "aria-pressed",
            "true",
        );
    });

    it("keeps the kind from the address", async () => {
        renderBoard("/fristen?kind=uvv");

        expect(await screen.findByText("HB-FN 1218")).toBeInTheDocument();
        expect(screen.queryByText("HB-HV 0007")).toBeNull();
    });

    it("switches the state with a tile and asks the list for it", async () => {
        renderBoard();
        await screen.findByText("HB-HV 0007");

        fireEvent.click(screen.getByRole("button", { name: /^In 30 Tagen/ }));

        await waitFor(() =>
            expect(vi.mocked(listDue).mock.calls.some(([query]) => query.state === "soon")).toBe(true),
        );
    });

    it("shows the error with a retry when the list cannot be loaded", async () => {
        vi.mocked(listDue).mockRejectedValue(new Error("Fristen konnten nicht geladen werden."));
        renderBoard();

        expect(
            await screen.findAllByText("Fristen konnten nicht geladen werden."),
        ).not.toHaveLength(0);
        expect(screen.getAllByRole("button", { name: "Erneut versuchen" }).length).toBeGreaterThan(0);
    });
});

describe("Fristen in an empty company", () => {
    it("says there is nothing to check yet instead of Nichts offen", async () => {
        vi.mocked(listDue).mockImplementation(async () => ({
            data: [],
            meta: {
                ...response(undefined).meta,
                total: 0,
                counts: { overdue: 0, soon: 0, missing: 0 },
                kind_counts: {
                    all: 0,
                    hu: 0,
                    uvv: 0,
                    licence_expiry: 0,
                    licence_check: 0,
                },
                subjects: { vehicles: 0, drivers: 0 },
            },
        }));
        renderBoard();

        expect(
            await screen.findByRole("heading", { name: "Noch nichts zu prüfen" }),
        ).toBeInTheDocument();
        expect(screen.queryByText(/Nichts offen/)).toBeNull();
        expect(
            screen.getByRole("link", { name: "Bestand importieren" }),
        ).toHaveAttribute("href", "/vehicles/import");
    });
});
