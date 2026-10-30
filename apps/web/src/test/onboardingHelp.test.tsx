import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FirstSteps } from "../components/briefing/FirstSteps";
import { HelpButton } from "../components/help/HelpButton";
import { PageTips } from "../components/help/PageTips";
import { requestPageTips } from "../components/help/tipCatalog";
import { markDueVisited } from "../hooks/useFirstSteps";
import { authUser, renderAuth } from "./renderAuth";

vi.mock("../api/auth", () => ({ listMembers: vi.fn() }));
vi.mock("../api/import", () => ({ listImportRuns: vi.fn() }));
vi.mock("../api/sites", () => ({ listSites: vi.fn() }));
vi.mock("../api/vehicles", () => ({ listVehicles: vi.fn() }));

import { listMembers, type Member } from "../api/auth";
import { listImportRuns } from "../api/import";
import { listSites } from "../api/sites";
import { listVehicles } from "../api/vehicles";

const pageMeta = (total: number) => ({
    page: 1,
    limit: 10,
    total,
    pageCount: total === 0 ? 0 : 1,
});

const mockSignals = ({
    vehicles = 0,
    runs = 0,
    sites = 0,
    members = 1,
}: {
    vehicles?: number;
    runs?: number;
    sites?: number;
    members?: number;
}) => {
    vi.mocked(listVehicles).mockResolvedValue({
        data: [],
        meta: {
            ...pageMeta(vehicles),
            counts: {
                all: vehicles,
                alerts: 0,
                low_fuel: 0,
                unassigned: 0,
                driving: 0,
                idle: 0,
                offline: 0,
                stopped: 0,
                in_depot: 0,
                speeding: 0,
                in_workshop: 0,
                workshop_due: 0,
                out_of_service: 0,
                damage_open: 0,
                not_drivable: 0,
                damage_unplanned: 0,
            },
        },
    });
    vi.mocked(listImportRuns).mockResolvedValue({
        data: [],
        meta: pageMeta(runs),
    });
    vi.mocked(listSites).mockResolvedValue({
        data: Array.from({ length: sites }, () => ({}) as never),
    });
    vi.mocked(listMembers).mockResolvedValue({
        data: Array.from(
            { length: members },
            (_, index): Member => ({
                user_id: index + 1,
                name: `Person ${index + 1}`,
                email: `p${index + 1}@example.com`,
                role: "dispatcher",
                invited: false,
            }),
        ),
    });
};

beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(listVehicles).mockReset();
    vi.mocked(listImportRuns).mockReset();
    vi.mocked(listSites).mockReset();
    vi.mocked(listMembers).mockReset();
});

describe("first steps on the Schicht page", () => {
    it("marks steps done from the company data and links the open ones", async () => {
        mockSignals({ vehicles: 12, sites: 2, members: 1 });
        renderAuth(<FirstSteps />, { user: authUser() });

        const panel = await screen.findByRole("complementary", {
            name: "Erste Schritte",
        });

        expect(within(panel).getByText("2 von 5")).toBeInTheDocument();
        expect(within(panel).getByRole("progressbar")).toHaveAttribute(
            "aria-valuenow",
            "2",
        );
        expect(within(panel).getByText("2 von 5")).toHaveAttribute(
            "title",
            "Erledigt: Bestand importieren (12 Fahrzeuge), Depot anlegen (2 Depots)",
        );
        expect(within(panel).getByRole("progressbar")).toHaveAttribute(
            "aria-valuetext",
            "2 von 5 erledigt",
        );
        expect(within(panel).getAllByRole("link")).toHaveLength(3);
        // Wide title row: open steps past the first one or two become "+N".
        expect(within(panel).getByText("+2")).toHaveAttribute(
            "title",
            "Team einladen, Zwei-Faktor einrichten",
        );
        expect(within(panel).getByText("+1")).toHaveAttribute(
            "title",
            "Zwei-Faktor einrichten",
        );
        expect(
            within(panel).queryByRole("link", { name: /Bestand importieren/ }),
        ).not.toBeInTheDocument();
        expect(
            within(panel).queryByRole("link", { name: /Depot anlegen/ }),
        ).not.toBeInTheDocument();
        expect(
            within(panel).getByRole("link", { name: /Fristen-Vorlauf prüfen/ }),
        ).toHaveAttribute("href", "/fristen");
        expect(
            within(panel).getByRole("link", { name: /Team einladen/ }),
        ).toHaveAttribute("href", "/konto");
        expect(
            within(panel).getByRole("link", { name: /Zwei-Faktor einrichten/ }),
        ).toHaveAttribute("href", "/konto");
    });

    it("counts an import run, a visit to Fristen, more members and TOTP", async () => {
        const user = authUser({ totp_enabled: true });
        markDueVisited(user);
        mockSignals({ vehicles: 0, runs: 1, sites: 0, members: 3 });
        renderAuth(<FirstSteps />, { user });

        const panel = await screen.findByRole("complementary", {
            name: "Erste Schritte",
        });

        expect(within(panel).getByText("4 von 5")).toHaveAttribute(
            "title",
            "Erledigt: Bestand importieren (Import gelaufen), Fristen-Vorlauf prüfen (Angesehen), Team einladen (3 Mitglieder), Zwei-Faktor einrichten (Eingerichtet)",
        );
        expect(within(panel).getAllByRole("link")).toHaveLength(1);
        expect(
            within(panel).getByRole("link", { name: /Depot anlegen/ }),
        ).toHaveAttribute("href", "/fleet");
    });

    it("leaves out a step whose state could not be loaded", async () => {
        mockSignals({ vehicles: 4 });
        vi.mocked(listMembers).mockRejectedValue(new Error("offline"));
        renderAuth(<FirstSteps />, { user: authUser() });

        const panel = await screen.findByRole("complementary", {
            name: "Erste Schritte",
        });

        expect(within(panel).getByText("1 von 4")).toBeInTheDocument();
        expect(within(panel).queryByText("Team einladen")).not.toBeInTheDocument();
    });

    it("hides after Ausblenden and stays hidden for this person and company", async () => {
        mockSignals({ vehicles: 12 });
        const user = authUser();
        const first = renderAuth(<FirstSteps />, { user });

        fireEvent.click(
            await screen.findByRole("button", { name: "Erste Schritte ausblenden" }),
        );

        expect(
            screen.queryByRole("complementary", { name: "Erste Schritte" }),
        ).not.toBeInTheDocument();

        first.unmount();
        vi.mocked(listVehicles).mockClear();
        renderAuth(<FirstSteps />, { user });

        expect(
            screen.queryByRole("complementary", { name: "Erste Schritte" }),
        ).not.toBeInTheDocument();
        expect(listVehicles).not.toHaveBeenCalled();
    });

    it("disappears when every step is done", async () => {
        const user = authUser({ totp_enabled: true });
        markDueVisited(user);
        mockSignals({ vehicles: 3, sites: 1, members: 2 });
        renderAuth(<FirstSteps />, { user });

        await vi.waitFor(() => expect(listMembers).toHaveBeenCalled());
        await act(async () => {});

        expect(
            screen.queryByRole("complementary", { name: "Erste Schritte" }),
        ).not.toBeInTheDocument();
    });

    it("is not shown to viewers or while the import question is open", () => {
        mockSignals({});
        const viewer = renderAuth(<FirstSteps />, {
            user: authUser({ role: "viewer" }),
        });
        viewer.unmount();
        renderAuth(<FirstSteps />, { user: authUser({ import_prompt: true }) });

        expect(listVehicles).not.toHaveBeenCalled();
        expect(
            screen.queryByRole("complementary", { name: "Erste Schritte" }),
        ).not.toBeInTheDocument();
    });
});

describe("help drawer", () => {
    it("opens help for the current page and closes on Escape", () => {
        renderAuth(<HelpButton />, { user: authUser(), route: "/fristen" });

        const button = screen.getByRole("button", {
            name: "Hilfe zu dieser Seite",
        });
        button.focus();
        fireEvent.click(button);

        const drawer = screen.getByRole("dialog", { name: "Hilfe · Fristen" });
        expect(button).toHaveAttribute("aria-expanded", "true");
        expect(
            within(drawer).getByRole("heading", { name: "Was zeigt diese Seite?" }),
        ).toBeInTheDocument();
        expect(
            within(drawer).getByRole("heading", {
                name: "Wo wird der Vorlauf eingestellt?",
            }),
        ).toBeInTheDocument();
        expect(
            within(drawer).getByRole("button", {
                name: "Tipps auf dieser Seite noch einmal zeigen",
            }),
        ).toBeInTheDocument();
        expect(drawer.querySelector("h2")).toHaveFocus();

        fireEvent.keyDown(document, { key: "Escape" });

        expect(
            screen.queryByRole("dialog", { name: "Hilfe · Fristen" }),
        ).not.toBeInTheDocument();
        expect(button).toHaveFocus();
    });

    it("shows dispatcher-only answers to dispatchers only", () => {
        const viewer = renderAuth(<HelpButton />, {
            user: authUser({ role: "viewer" }),
            route: "/",
        });
        fireEvent.click(screen.getByRole("button", { name: "Hilfe zu dieser Seite" }));

        expect(screen.getByRole("dialog", { name: "Hilfe · Schicht" })).toBeInTheDocument();
        expect(screen.queryByText("Was lädt „Monat“ herunter?")).not.toBeInTheDocument();
        viewer.unmount();

        renderAuth(<HelpButton />, { user: authUser(), route: "/" });
        fireEvent.click(screen.getByRole("button", { name: "Hilfe zu dieser Seite" }));

        expect(screen.getByText("Was lädt „Monat“ herunter?")).toBeInTheDocument();
    });

    it("closes with the close button and has help for the detail routes", () => {
        renderAuth(<HelpButton />, { user: authUser(), route: "/vehicles/12" });
        fireEvent.click(screen.getByRole("button", { name: "Hilfe zu dieser Seite" }));

        expect(screen.getByRole("dialog", { name: "Hilfe · Fahrzeug" })).toBeInTheDocument();
        expect(
            screen.queryByRole("button", {
                name: "Tipps auf dieser Seite noch einmal zeigen",
            }),
        ).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Hilfe schließen" }));

        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("has no help button where there is no page help", () => {
        renderAuth(<HelpButton />, { user: authUser(), route: "/gibt-es-nicht" });

        expect(
            screen.queryByRole("button", { name: "Hilfe zu dieser Seite" }),
        ).not.toBeInTheDocument();
    });
});

describe("page tips", () => {
    const FristenTargets = () => (
        <>
            <div data-tip="due-tiles" />
            <div data-tip="due-kinds" />
            <div data-tip="due-settings" />
            <PageTips page="fristen" />
        </>
    );

    it("shows once, steps through and comes back from the help drawer", async () => {
        const user = authUser();
        const first = renderAuth(<FristenTargets />, { user });

        expect(
            await screen.findByRole("dialog", { name: "Kachel = Filter" }),
        ).toBeInTheDocument();
        expect(screen.getByText("Tipp 1 von 3")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
        expect(
            await screen.findByRole("dialog", { name: "Art und Regel" }),
        ).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Überspringen" }));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

        first.unmount();
        renderAuth(<FristenTargets />, { user });
        await act(async () => {});
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

        act(() => requestPageTips("fristen"));

        expect(
            await screen.findByRole("dialog", { name: "Kachel = Filter" }),
        ).toBeInTheDocument();
    });

    it("ignores an Escape that belongs to something else with focus", async () => {
        renderAuth(
            <>
                <FristenTargets />
                <button type="button">Menü</button>
            </>,
            { user: authUser() },
        );
        await screen.findByRole("dialog", { name: "Kachel = Filter" });

        screen.getByRole("button", { name: "Menü" }).focus();
        fireEvent.keyDown(document, { key: "Escape" });
        expect(
            screen.getByRole("dialog", { name: "Kachel = Filter" }),
        ).toBeInTheDocument();

        screen.getByRole("button", { name: "Menü" }).blur();
        fireEvent.keyDown(document, { key: "Escape" });
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
});
