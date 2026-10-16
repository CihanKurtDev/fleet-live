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
    disableTotp: vi.fn(),
    getSecurity: vi.fn(),
    inviteMember: vi.fn(),
    listMembers: vi.fn(),
    removeMember: vi.fn(),
    setMemberRole: vi.fn(),
    setupTotp: vi.fn(),
    switchCompany: vi.fn(),
    updateSecurity: vi.fn(),
}));

import {
    changePassword,
    confirmTotpSetup,
    createCompany,
    disableTotp,
    getSecurity,
    inviteMember,
    listMembers,
    removeMember,
    setMemberRole,
    setupTotp,
    switchCompany,
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
    sso_secret_set: false,
};

const memberRow = async (email: string) => {
    let row: HTMLElement | undefined;

    await waitFor(() => {
        row = [...document.querySelectorAll<HTMLElement>("tbody tr")].find((item) =>
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
        vi.mocked(removeMember).mockReset();
        vi.mocked(listMembers).mockResolvedValue({ data: members });
        vi.mocked(getSecurity).mockResolvedValue(security);
        vi.mocked(changePassword).mockReset();
        vi.mocked(confirmTotpSetup).mockReset();
        vi.mocked(createCompany).mockReset();
        vi.mocked(inviteMember).mockReset();
        vi.mocked(removeMember).mockReset();
        vi.mocked(setMemberRole).mockReset();
        vi.mocked(setupTotp).mockReset();
        vi.mocked(switchCompany).mockReset();
        vi.mocked(updateSecurity).mockReset();
    });

    it("changes the password and keeps the current session message", async () => {
        vi.mocked(changePassword).mockResolvedValue(undefined);
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto" });

        expect(
            await screen.findByText(
                "Cihan Kurt · cihan@example.com · Dispatcher bei Rheinland Logistik",
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
            route: "/konto#zwei-faktor",
        });

        fireEvent.click(
            await screen.findByRole("button", { name: "Einrichtung starten" }),
        );
        expect(
            await screen.findByText(
                "Schlüssel für die Authenticator-App: SECRET",
            ),
        ).toBeInTheDocument();
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

    it("turns second factor off with a current code", async () => {
        const user = authUser({ totp_enabled: true });
        vi.mocked(disableTotp).mockResolvedValue({ ...user, totp_enabled: false });
        const { setUser } = renderAuth(<AccountPage />, {
            user,
            route: "/konto#zwei-faktor",
        });

        fireEvent.change(await screen.findByLabelText("Code aus der App"), {
            target: { value: "654321" },
        });
        submit("Zwei-Faktor ausschalten");

        expect(
            await screen.findByText("Zwei-Faktor ist ausgeschaltet."),
        ).toBeInTheDocument();
        expect(disableTotp).toHaveBeenCalledWith("654321");
        expect(setUser).toHaveBeenCalledWith(
            expect.objectContaining({ totp_enabled: false }),
        );
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
            route: "/konto#firmen",
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
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto#team" });

        fireEvent.change(await screen.findByLabelText("E-Mail"), {
            target: { value: "neu@example.com" },
        });
        submit("Einladen");

        expect(
            await screen.findByText(
                "Einladung angelegt. Ein Mailversand ist nicht eingerichtet — der Link steht im Server-Log, nicht im Posteingang.",
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
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto#team" });

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
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto#team" });

        const row = await memberRow("viewer@example.com");
        fireEvent.click(within(row).getByRole("button", { name: "Entfernen" }));

        const dialog = await screen.findByRole("dialog", {
            name: "Mitglied entfernen?",
            hidden: true,
        });
        expect(removeMember).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole("button", { name: "Entfernen" }));

        await waitFor(() => {
            expect(
                [...document.querySelectorAll("tbody tr")].some((item) =>
                    item.textContent?.includes("viewer@example.com"),
                ),
            ).toBe(false);
        });
        expect(await memberRow("cihan@example.com")).toBeInTheDocument();
        expect(removeMember).toHaveBeenCalledWith(2);
        expect(await screen.findByText("Viewer entfernt.")).toBeInTheDocument();
    });

    it("keeps the member when the removal is cancelled", async () => {
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto#team" });

        const row = await memberRow("viewer@example.com");
        fireEvent.click(within(row).getByRole("button", { name: "Entfernen" }));
        const dialog = await screen.findByRole("dialog", {
            name: "Mitglied entfernen?",
            hidden: true,
        });
        fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));

        expect(removeMember).not.toHaveBeenCalled();
        expect(await memberRow("viewer@example.com")).toBeInTheDocument();
    });

    it("saves the company second-factor requirement", async () => {
        vi.mocked(updateSecurity).mockResolvedValue({
            ...security,
            totp_required: true,
            sso_issuer: "https://idp.example",
            sso_client_id: "client-id",
            sso_secret_set: true,
            sso_configured: true,
        });
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto#firmen-login" });

        fireEvent.click(
            await screen.findByRole("checkbox", {
                name: "Zwei-Faktor für alle verlangen",
            }),
        );
        fireEvent.change(screen.getByLabelText("OIDC-Issuer"), {
            target: { value: "https://idp.example" },
        });
        fireEvent.change(screen.getByLabelText("Client-ID"), {
            target: { value: "client-id" },
        });
        fireEvent.change(screen.getByLabelText("Client-Geheimnis"), {
            target: { value: "secret-value" },
        });
        submit("Einstellungen speichern");

        expect(
            await screen.findByRole("status"),
        ).toHaveTextContent("Das Client-Geheimnis bleibt hinterlegt");
        expect(screen.getByLabelText("OIDC-Issuer")).toHaveValue(
            "https://idp.example",
        );
        expect(screen.getByLabelText("Client-ID")).toHaveValue("client-id");
        expect(screen.getByLabelText("Client-Geheimnis")).toHaveValue("");
        expect(updateSecurity).toHaveBeenCalledWith({
            totp_required: true,
            sso_required: false,
            sso_issuer: "https://idp.example",
            sso_client_id: "client-id",
            sso_client_secret: "secret-value",
        });
    });

    it("hides company administration from a viewer", async () => {
        renderAuth(<AccountPage />, {
            user: authUser({ role: "viewer" }),
            route: "/konto#team",
        });

        expect(
            await screen.findByRole("heading", { name: "Konto" }),
        ).toBeInTheDocument();
        expect(
            screen.getByText(
                "Cihan Kurt · cihan@example.com · Lesezugriff bei Rheinland Logistik",
            ),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole("heading", { name: "Jemanden einladen" }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("heading", { name: "Firmen-Login" }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("link", { name: "Team und Einladungen" }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("link", { name: "Firmen-Login" }),
        ).not.toBeInTheDocument();
        // #team is not open to a viewer: the page falls back to the password.
        expect(screen.getByLabelText("Aktuelles Passwort")).toBeInTheDocument();
        expect(listMembers).not.toHaveBeenCalled();
        expect(getSecurity).not.toHaveBeenCalled();
    });

    it("shows only the section picked in the side navigation", async () => {
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto" });

        const nav = await screen.findByRole("navigation", {
            name: "Kontobereiche",
        });
        expect(
            within(nav).getByRole("link", { name: "Passwort" }),
        ).toHaveAttribute("aria-current", "page");
        expect(screen.getByLabelText("Aktuelles Passwort")).toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Einrichtung starten" }),
        ).not.toBeInTheDocument();

        fireEvent.click(
            within(nav).getByRole("link", { name: "Zwei-Faktor · aus" }),
        );
        expect(
            await screen.findByRole("button", { name: "Einrichtung starten" }),
        ).toBeInTheDocument();
        expect(
            screen.queryByLabelText("Aktuelles Passwort"),
        ).not.toBeInTheDocument();
        expect(
            within(nav).getByRole("link", { name: "Zwei-Faktor · aus" }),
        ).toHaveAttribute("aria-current", "page");

        fireEvent.click(
            within(nav).getByRole("link", { name: "Team und Einladungen" }),
        );
        expect(await screen.findByLabelText("E-Mail")).toBeInTheDocument();
        expect(await memberRow("viewer@example.com")).toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Einrichtung starten" }),
        ).not.toBeInTheDocument();

        fireEvent.click(within(nav).getByRole("link", { name: "Firmen-Login" }));
        expect(await screen.findByLabelText("OIDC-Issuer")).toBeInTheDocument();
        expect(screen.queryByLabelText("E-Mail")).not.toBeInTheDocument();
    });

    it("switches to another company from the company section", async () => {
        const user = authUser({
            memberships: [
                {
                    company_id: 1,
                    company_name: "Rheinland Logistik",
                    role: "dispatcher",
                },
                {
                    company_id: 9,
                    company_name: "Nord Logistik",
                    role: "viewer",
                },
            ],
        });
        const next = authUser({
            ...user,
            company_id: 9,
            company_name: "Nord Logistik",
            role: "viewer",
        });
        vi.mocked(switchCompany).mockResolvedValue(next);
        const { setUser } = renderAuth(<AccountPage />, {
            user,
            route: "/konto#firmen",
        });

        expect(await screen.findByText("Aktiv")).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole("button", { name: "Zu Nord Logistik wechseln" }),
        );

        expect(
            await screen.findByText("Du arbeitest jetzt in Nord Logistik."),
        ).toBeInTheDocument();
        expect(switchCompany).toHaveBeenCalledWith(9);
        expect(setUser).toHaveBeenCalledWith(next);
    });
});
