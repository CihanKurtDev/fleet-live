import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/client";
import { AccountPage } from "../pages/AccountPage";
import { authUser, renderAuth } from "./renderAuth";

vi.mock("qrcode", () => ({
    default: {
        toDataURL: vi.fn(async () => "data:image/png;base64,qr"),
    },
}));

vi.mock("../api/auth", () => ({
    changePassword: vi.fn(),
    confirmTotpSetup: vi.fn(),
    createCompany: vi.fn(),
    getSecurity: vi.fn(),
    inviteMember: vi.fn(),
    listMembers: vi.fn(),
    removeMember: vi.fn(),
    setMemberRole: vi.fn(),
    setupTotp: vi.fn(),
    updateSecurity: vi.fn(),
}));

import {
    changePassword,
    confirmTotpSetup,
    createCompany,
    getSecurity,
    inviteMember,
    listMembers,
    removeMember,
    setMemberRole,
    setupTotp,
    updateSecurity,
} from "../api/auth";

const members = [
    {
        user_id: 1,
        name: "Cihan Kurt",
        email: "cihan@example.com",
        role: "dispatcher" as const,
    },
    {
        user_id: 2,
        name: "Viewer",
        email: "viewer@example.com",
        role: "viewer" as const,
    },
];

const security = {
    totp_required: false,
    sso_required: false,
    sso_issuer: null,
    sso_client_id: null,
    sso_configured: false,
};

const memberRow = async (email: string) => {
    let row: HTMLElement | undefined;

    await waitFor(() => {
        row = [...document.querySelectorAll("li")].find((item) =>
            item.textContent?.includes(email),
        );
        expect(row).toBeInstanceOf(HTMLElement);
    });

    return row as HTMLElement;
};

const submit = (name: string) => {
    const button = screen.getByRole("button", { name });
    const form = button.closest("form");

    if (!form) {
        throw new Error(`Kein Formular für ${name}`);
    }

    fireEvent.submit(form);
};

describe("account page", () => {
    beforeEach(() => {
        vi.mocked(listMembers).mockResolvedValue({ data: members });
        vi.mocked(getSecurity).mockResolvedValue(security);
        vi.mocked(changePassword).mockReset();
        vi.mocked(confirmTotpSetup).mockReset();
        vi.mocked(createCompany).mockReset();
        vi.mocked(inviteMember).mockReset();
        vi.mocked(removeMember).mockReset();
        vi.mocked(setMemberRole).mockReset();
        vi.mocked(setupTotp).mockReset();
        vi.mocked(updateSecurity).mockReset();
    });

    it("changes the password and keeps the current session message", async () => {
        vi.mocked(changePassword).mockResolvedValue(undefined);
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto" });

        expect(
            await screen.findByText(
                "Cihan Kurt · cihan@example.com · Rheinland Logistik",
            ),
        ).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText("Aktuelles Passwort"), {
            target: { value: "development-only-password" },
        });
        fireEvent.change(screen.getByLabelText("Neues Passwort"), {
            target: { value: "another-development-password" },
        });
        submit("Passwort speichern");

        expect(
            await screen.findByText(
                "Passwort geändert. Andere Anmeldungen sind beendet.",
            ),
        ).toBeInTheDocument();
        expect(changePassword).toHaveBeenCalledWith(
            "development-only-password",
            "another-development-password",
        );
    });

    it("shows recovery codes after the authenticator setup", async () => {
        const user = authUser();
        vi.mocked(setupTotp).mockResolvedValue({
            secret: "SECRET",
            otpauth_url: "otpauth://totp/fleet",
            setup_token: "setup-1",
        });
        vi.mocked(confirmTotpSetup).mockResolvedValue({
            ...user,
            totp_enabled: true,
            recovery_codes: ["code-1", "code-2"],
        });
        const { setUser } = renderAuth(<AccountPage />, {
            user,
            route: "/konto",
        });

        fireEvent.click(
            await screen.findByRole("button", { name: "Einrichtung starten" }),
        );
        expect(await screen.findByText("Geheimnis: SECRET")).toBeInTheDocument();
        expect(
            await screen.findByAltText("QR-Code für die Authenticator-App"),
        ).toHaveAttribute("src", "data:image/png;base64,qr");

        fireEvent.change(screen.getByLabelText("Code aus der App"), {
            target: { value: "123456" },
        });
        submit("Code bestätigen");

        expect(await screen.findByText("code-1")).toBeInTheDocument();
        expect(screen.getByText("code-2")).toBeInTheDocument();
        expect(setUser).toHaveBeenCalledWith(
            expect.objectContaining({ totp_enabled: true }),
        );
        expect(confirmTotpSetup).toHaveBeenCalledWith({
            code: "123456",
            setup_token: "setup-1",
        });
    });

    it("switches into a newly created company", async () => {
        const next = authUser({
            company_id: 9,
            company_name: "Nord Logistik",
            import_prompt: true,
            memberships: [
                {
                    company_id: 1,
                    company_name: "Rheinland Logistik",
                    role: "dispatcher",
                },
                {
                    company_id: 9,
                    company_name: "Nord Logistik",
                    role: "dispatcher",
                },
            ],
        });
        vi.mocked(createCompany).mockResolvedValue(next);
        const { setUser } = renderAuth(<AccountPage />, {
            user: authUser(),
            route: "/konto",
        });

        fireEvent.change(screen.getByLabelText("Firmenname"), {
            target: { value: "Nord Logistik" },
        });
        submit("Firma anlegen und wechseln");

        expect(
            await screen.findByText(
                "Die neue Firma ist leer. Du bist dorthin gewechselt.",
            ),
        ).toBeInTheDocument();
        expect(setUser).toHaveBeenCalledWith(next);
    });

    it("tells a dispatcher when the invite link is only in the log", async () => {
        vi.mocked(inviteMember).mockResolvedValue({
            delivery: "log",
            message: "Mail versendet.",
        });
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto" });

        fireEvent.change(await screen.findByLabelText("E-Mail"), {
            target: { value: "neu@example.com" },
        });
        submit("Einladen");

        expect(
            await screen.findByText(
                "Einladung angelegt. Der Link steht im API-Log.",
            ),
        ).toBeInTheDocument();
        expect(inviteMember).toHaveBeenCalledWith("neu@example.com", "viewer");
    });

    it("keeps the last dispatcher and shows the error", async () => {
        vi.mocked(setMemberRole).mockRejectedValue(
            new ApiError(
                "Der letzte Dispatcher bleibt.",
                403,
                undefined,
                "LAST_DISPATCHER",
            ),
        );
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto" });

        const row = await memberRow("cihan@example.com");
        fireEvent.change(within(row).getByLabelText("Rolle von Cihan Kurt"), {
            target: { value: "viewer" },
        });

        expect(
            await screen.findByRole("alert"),
        ).toHaveTextContent("Der letzte Dispatcher bleibt.");
        expect(within(row).getByLabelText("Rolle von Cihan Kurt")).toHaveValue(
            "dispatcher",
        );
    });

    it("removes another member", async () => {
        vi.mocked(removeMember).mockResolvedValue(undefined);
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto" });

        const row = await memberRow("viewer@example.com");
        fireEvent.click(within(row).getByRole("button", { name: "Entfernen" }));

        await waitFor(() => {
            expect(
                [...document.querySelectorAll("li")].some((item) =>
                    item.textContent?.includes("viewer@example.com"),
                ),
            ).toBe(false);
        });
        expect(await memberRow("cihan@example.com")).toBeInTheDocument();
        expect(removeMember).toHaveBeenCalledWith(2);
    });

    it("saves the company second-factor requirement", async () => {
        vi.mocked(updateSecurity).mockResolvedValue({
            ...security,
            totp_required: true,
            sso_issuer: "https://idp.example",
        });
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto" });

        fireEvent.click(
            await screen.findByRole("checkbox", {
                name: "Zwei-Faktor für alle verlangen",
            }),
        );
        fireEvent.change(screen.getByLabelText("OIDC-Issuer"), {
            target: { value: "https://idp.example" },
        });
        submit("Einstellungen speichern");

        expect(
            await screen.findByText("Firmeneinstellungen gespeichert."),
        ).toBeInTheDocument();
        expect(updateSecurity).toHaveBeenCalledWith({
            totp_required: true,
            sso_required: false,
            sso_issuer: "https://idp.example",
            sso_client_id: null,
            sso_client_secret: undefined,
        });
    });

    it("hides company administration from a viewer", async () => {
        renderAuth(<AccountPage />, {
            user: authUser({ role: "viewer" }),
            route: "/konto",
        });

        expect(
            await screen.findByRole("heading", { name: "Konto" }),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole("heading", { name: "Einladen" }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("heading", { name: "Firmen-Login" }),
        ).not.toBeInTheDocument();
        expect(listMembers).not.toHaveBeenCalled();
        expect(getSecurity).not.toHaveBeenCalled();
    });
});
