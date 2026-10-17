import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HomeRoute } from "../pages/HomeRoute";
import { authUser, renderAuth } from "./renderAuth";

vi.mock("../pages/BriefingPage", () => ({
    BriefingPage: () => <h1>Schicht</h1>,
}));

describe("start page", () => {
    it("shows the landing page to visitors, with real sign-in and sign-up links", async () => {
        renderAuth(<HomeRoute />);

        expect(
            await screen.findByRole("heading", { level: 1, name: /Wer fährt/ }),
        ).toBeInTheDocument();

        const hrefs = screen
            .getAllByRole("link")
            .map((link) => link.getAttribute("href"));

        expect(hrefs).toContain("/login");
        expect(hrefs).toContain("/registrieren");
        expect(hrefs).toContain("/passwort-vergessen");
        expect(
            hrefs.filter((href) => !href || href === "#"),
        ).toHaveLength(0);
    });

    it("shows Schicht once signed in", async () => {
        renderAuth(<HomeRoute />, { user: authUser() });

        expect(
            await screen.findByRole("heading", { level: 1, name: "Schicht" }),
        ).toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: /Wer fährt/ })).toBeNull();
    });
});
