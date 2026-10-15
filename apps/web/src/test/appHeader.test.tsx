import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppHeader } from "../components/AppHeader";
import { authUser, renderAuth } from "./renderAuth";

vi.mock("../api/auth", () => ({
    logout: vi.fn(),
    switchCompany: vi.fn(),
}));

vi.mock("../api/sim", () => ({
    getSim: vi.fn(),
    setSimRunning: vi.fn(),
}));

import { logout } from "../api/auth";
import { getSim } from "../api/sim";

const openMenu = () => {
    const button = screen.getByRole("button", { name: "Menü öffnen" });
    fireEvent.click(button);

    const drawer = document.getElementById(
        button.getAttribute("aria-controls") ?? "",
    );

    if (!drawer) {
        throw new Error("Menü wurde nicht geöffnet.");
    }

    return { button, drawer };
};

describe("phone menu", () => {
    beforeEach(() => {
        vi.mocked(getSim).mockResolvedValue({ available: true, running: true });
        vi.mocked(logout).mockReset();
    });

    it("names the current section next to the menu button", () => {
        renderAuth(<AppHeader />, { user: authUser(), route: "/" });

        expect(screen.getByText("Schicht")).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Menü öffnen" }),
        ).toHaveAttribute("aria-expanded", "false");
    });

    it("opens a drawer with identity, all sections and the session actions", async () => {
        renderAuth(<AppHeader openAlertCount={745} />, {
            user: authUser(),
            route: "/vehicles",
        });

        const { button, drawer } = openMenu();
        const menu = within(drawer);

        expect(
            screen.getByRole("button", { name: "Menü schließen" }),
        ).toBe(button);
        expect(button).toHaveAttribute("aria-expanded", "true");
        expect(
            menu.getByText("Rheinland Logistik · Cihan Kurt"),
        ).toBeInTheDocument();

        const nav = menu.getByRole("navigation", { name: "Hauptnavigation" });
        const links = within(nav).getAllByRole("link");
        expect(links.map((link) => link.getAttribute("href"))).toEqual([
            "/",
            "/vehicles",
            "/fleet",
            "/alerts",
            "/fristen",
            "/drivers",
            "/konto",
        ]);
        expect(
            within(nav).getByRole("link", { name: "Schicht" }),
        ).toHaveFocus();
        expect(
            within(nav).getByRole("link", { name: /^Warnungen/ }),
        ).toHaveTextContent("745");
        expect(
            within(nav).getByRole("link", { name: "Fahrzeuge" }),
        ).toHaveAttribute("aria-current", "page");

        expect(
            await menu.findByRole("button", { name: "Simulation pausieren" }),
        ).toBeInTheDocument();
        expect(
            menu.getByRole("button", { name: "Abmelden" }),
        ).toBeInTheDocument();
    });

    it("closes on Escape and returns focus to the menu button", () => {
        renderAuth(<AppHeader />, { user: authUser(), route: "/vehicles" });

        const { button, drawer } = openMenu();
        fireEvent.keyDown(document, { key: "Escape" });

        expect(drawer).not.toBeInTheDocument();
        expect(button).toHaveAttribute("aria-expanded", "false");
        expect(button).toHaveAccessibleName("Menü öffnen");
        expect(button).toHaveFocus();
    });

    it("closes when a section is chosen", () => {
        renderAuth(<AppHeader />, { user: authUser(), route: "/vehicles" });

        const { drawer } = openMenu();
        fireEvent.click(
            within(drawer).getByRole("link", { name: "Konto" }),
        );

        expect(drawer).not.toBeInTheDocument();
        expect(screen.getByText("Konto")).toBeInTheDocument();
    });

    it("hides the simulation for viewers and offers the company switch", () => {
        renderAuth(<AppHeader />, {
            user: authUser({
                role: "viewer",
                memberships: [
                    {
                        company_id: 1,
                        company_name: "Rheinland Logistik",
                        role: "viewer",
                    },
                    {
                        company_id: 2,
                        company_name: "Nord Logistik",
                        role: "dispatcher",
                    },
                ],
            }),
            route: "/alerts",
        });

        const { drawer } = openMenu();
        const menu = within(drawer);

        expect(menu.getByRole("combobox", { name: "Firma" })).toHaveValue("1");
        expect(menu.getByText("Cihan Kurt")).toBeInTheDocument();
        expect(
            menu.queryByRole("button", { name: /Simulation/ }),
        ).not.toBeInTheDocument();
        expect(getSim).not.toHaveBeenCalled();
    });

    it("signs out from the drawer", async () => {
        const { setUser } = renderAuth(<AppHeader />, {
            user: authUser(),
            route: "/vehicles",
        });

        const { drawer } = openMenu();
        fireEvent.click(
            within(drawer).getByRole("button", { name: "Abmelden" }),
        );

        await vi.waitFor(() => expect(setUser).toHaveBeenCalledWith(null));
        expect(logout).toHaveBeenCalledOnce();
    });
});
