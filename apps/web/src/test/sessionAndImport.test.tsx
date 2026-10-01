import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImportPrompt } from "../components/auth/ImportPrompt";
import { SessionMenu } from "../components/SessionMenu";
import { authUser, renderAuth } from "./renderAuth";

vi.mock("../api/auth", () => ({
    logout: vi.fn(),
    switchCompany: vi.fn(),
    dismissImportPrompt: vi.fn(),
}));

import { dismissImportPrompt, logout, switchCompany } from "../api/auth";

describe("session menu", () => {
    beforeEach(() => {
        vi.mocked(logout).mockReset();
        vi.mocked(switchCompany).mockReset();
    });

    it("shows the company name when there is one membership", () => {
        renderAuth(<SessionMenu />, { user: authUser() });

        expect(screen.getByText("Rheinland Logistik")).toBeInTheDocument();
        expect(
            screen.getByRole("link", { name: "Konto, Cihan Kurt" }),
        ).toHaveAttribute("href", "/konto");
        expect(screen.queryByRole("link", { name: "Konto" })).not.toBeInTheDocument();
        expect(
            screen.queryByRole("combobox", { name: "Firma" }),
        ).not.toBeInTheDocument();
    });

    it("switches the active company", async () => {
        const user = authUser({
            memberships: [
                {
                    company_id: 1,
                    company_name: "Rheinland Logistik",
                    role: "dispatcher",
                },
                {
                    company_id: 2,
                    company_name: "Nord Logistik",
                    role: "viewer",
                },
            ],
        });
        const next = authUser({
            ...user,
            company_id: 2,
            company_name: "Nord Logistik",
            role: "viewer",
        });
        vi.mocked(switchCompany).mockResolvedValue(next);
        const { setUser } = renderAuth(<SessionMenu />, { user });

        fireEvent.change(screen.getByRole("combobox", { name: "Firma" }), {
            target: { value: "2" },
        });

        expect(switchCompany).toHaveBeenCalledWith(2);
        await vi.waitFor(() => expect(setUser).toHaveBeenCalledWith(next));
    });

    it("keeps the current company when the switch fails", async () => {
        const user = authUser({
            memberships: [
                {
                    company_id: 1,
                    company_name: "Rheinland Logistik",
                    role: "dispatcher",
                },
                {
                    company_id: 2,
                    company_name: "Nord Logistik",
                    role: "dispatcher",
                },
            ],
        });
        vi.mocked(switchCompany).mockRejectedValue(new Error("SSO"));
        const { setUser } = renderAuth(<SessionMenu />, { user });

        fireEvent.change(screen.getByRole("combobox", { name: "Firma" }), {
            target: { value: "2" },
        });

        await vi.waitFor(() => expect(setUser).toHaveBeenCalledWith(user));
        expect(screen.getByRole("combobox", { name: "Firma" })).toHaveValue(
            "1",
        );
    });

    it("clears the session even when logout fails", async () => {
        vi.mocked(logout).mockRejectedValue(new Error("offline"));
        const { setUser } = renderAuth(<SessionMenu />, { user: authUser() });

        fireEvent.click(screen.getByRole("button", { name: "Abmelden" }));

        await vi.waitFor(() => expect(setUser).toHaveBeenCalledWith(null));
    });

    it("links to login when nobody is signed in", () => {
        renderAuth(<SessionMenu />, { user: null });

        expect(screen.getByRole("link", { name: "Anmelden" })).toHaveAttribute(
            "href",
            "/login",
        );
    });
});

describe("import prompt", () => {
    it("stays hidden once the company has vehicles or the prompt was dismissed", () => {
        renderAuth(<ImportPrompt />, { user: authUser() });

        expect(
            screen.queryByText(/Stammdaten kannst du/),
        ).not.toBeInTheDocument();
    });

    it("links to the import and dismisses the question", async () => {
        const user = authUser({ import_prompt: true });
        const dismissed = authUser({ import_prompt: false });
        vi.mocked(dismissImportPrompt).mockResolvedValue(dismissed);
        const { setUser } = renderAuth(<ImportPrompt />, { user });

        expect(screen.getByRole("link", { name: "Importieren" })).toHaveAttribute(
            "href",
            "/vehicles/import",
        );
        fireEvent.click(screen.getByRole("button", { name: "Später" }));

        await vi.waitFor(() =>
            expect(setUser).toHaveBeenCalledWith(dismissed),
        );
        expect(dismissImportPrompt).toHaveBeenCalledOnce();
    });
});
