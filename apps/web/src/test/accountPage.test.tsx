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
    acceptInvitation: vi.fn(),
    addDomain: vi.fn(),
    changePassword: vi.fn(),
    confirmTotpSetup: vi.fn(),
    createCompany: vi.fn(),
    declineInvitation: vi.fn(),
    disableTotp: vi.fn(),
    getPrivacy: vi.fn(),
    getSecurity: vi.fn(),
    getSsoProviders: vi.fn(),
    inviteMember: vi.fn(),
    listAudit: vi.fn(),
    listDomains: vi.fn(),
    listInvitations: vi.fn(),
    listMembers: vi.fn(),
    removeDomain: vi.fn(),
    removeMember: vi.fn(),
    savePrivacy: vi.fn(),
    setMemberRole: vi.fn(),
    setupTotp: vi.fn(),
    startSsoLink: vi.fn(),
    switchCompany: vi.fn(),
    unlinkSso: vi.fn(),
    updateSecurity: vi.fn(),
    verifyDomain: vi.fn(),
    withdrawInvite: vi.fn(),
}));

import {
    acceptInvitation,
    addDomain,
    changePassword,
    confirmTotpSetup,
    createCompany,
    declineInvitation,
    disableTotp,
    getPrivacy,
    getSecurity,
    getSsoProviders,
    inviteMember,
    listAudit,
    listDomains,
    listInvitations,
    listMembers,
    removeDomain,
    removeMember,
    savePrivacy,
    setMemberRole,
    setupTotp,
    startSsoLink,
    switchCompany,
    unlinkSso,
    updateSecurity,
    verifyDomain,
    withdrawInvite,
} from "../api/auth";

const members = [
    {
        user_id: 1,
        name: "Cihan Kurt",
        email: "cihan@example.com",
        role: "dispatcher" as const,
        invited: false,
    },
    {
        user_id: 2,
        name: "Viewer",
        email: "viewer@example.com",
        role: "viewer" as const,
        invited: false,
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
        vi.mocked(listInvitations).mockResolvedValue({ data: [] });
        vi.mocked(getSsoProviders).mockResolvedValue({ google: false, microsoft: false });
        vi.mocked(listDomains).mockResolvedValue({ data: [] });
        vi.mocked(listAudit).mockResolvedValue({
            data: [],
            meta: { page: 1, limit: 50, total: 0, pageCount: 1 },
        });
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

    it("links the own account first when the company login is to be required", async () => {
        vi.mocked(getSecurity).mockResolvedValue({
            ...security,
            sso_issuer: "https://idp.example",
            sso_client_id: "client-id",
            sso_secret_set: true,
            sso_configured: true,
        });
        vi.mocked(updateSecurity).mockRejectedValue(
            new ApiError(
                "Verknüpfe zuerst dein Konto mit dem Firmen-Login, dann lässt er sich verlangen.",
                403,
                undefined,
                "SSO_LINK_REQUIRED",
                { company_id: 1 },
            ),
        );
        vi.mocked(startSsoLink).mockResolvedValue({ url: "https://idp.example/auth?state=s" });
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto#firmen-login" });

        fireEvent.click(await screen.findByRole("checkbox", { name: "Firmen-Login verlangen" }));
        const assigned: string[] = [];
        const realLocation = window.location;
        const spy = vi.spyOn(window, "location", "get").mockImplementation(
            () =>
                new Proxy(realLocation, {
                    get(target, property) {
                        const value = Reflect.get(target, property, target);
                        return typeof value === "function" ? value.bind(target) : value;
                    },
                    set(target, property, value) {
                        if (property === "href") {
                            assigned.push(String(value));
                            return true;
                        }

                        return Reflect.set(target, property, value);
                    },
                }) as Location,
        );
        submit("Einstellungen speichern");

        await waitFor(() => {
            expect(assigned).toEqual(["https://idp.example/auth?state=s"]);
        });
        spy.mockRestore();
        expect(startSsoLink).toHaveBeenCalledWith({ provider: "company", company_id: 1 });
    });

    it("says when the company login was linked", async () => {
        vi.mocked(getSecurity).mockResolvedValue(security);
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto?sso=linked#firmen-login" });

        expect(await screen.findByRole("status")).toHaveTextContent(
            "Dein Konto ist mit dem Firmen-Login verknüpft.",
        );
    });

    it("says why the company login could not be linked", async () => {
        vi.mocked(getSecurity).mockResolvedValue(security);
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto?sso=mismatch#firmen-login" });

        expect(await screen.findByRole("alert")).toHaveTextContent(
            "Der Firmen-Login meldet eine andere oder unbestätigte E-Mail.",
        );
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

    it("accepts an invitation into another company", async () => {
        const user = authUser({ invitations: 1 });
        vi.mocked(listInvitations).mockResolvedValue({
            data: [
                {
                    company_id: 7,
                    company_name: "Nord Logistik",
                    role: "viewer",
                    invited_by_name: "Ada",
                    created_at: "2026-10-28 09:00:00",
                },
            ],
        });
        const next = authUser({
            invitations: 0,
            memberships: [
                ...user.memberships,
                { company_id: 7, company_name: "Nord Logistik", role: "viewer" },
            ],
        });
        vi.mocked(acceptInvitation).mockResolvedValue(next);
        const { setUser } = renderAuth(<AccountPage />, { user, route: "/konto#firmen" });

        expect(await screen.findByText("Nur lesen · von Ada", { exact: false })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /1 Einladung/ })).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole("button", { name: "Einladung von Nord Logistik annehmen" }),
        );

        expect(
            await screen.findByText(
                "Du bist jetzt Mitglied bei Nord Logistik. Du arbeitest weiter in Rheinland Logistik; wechseln kannst du unter „Deine Firmen“.",
            ),
        ).toBeInTheDocument();
        expect(acceptInvitation).toHaveBeenCalledWith(7);
        expect(declineInvitation).not.toHaveBeenCalled();
        expect(setUser).toHaveBeenCalledWith(next);
    });

    it("declines an invitation", async () => {
        const user = authUser({ invitations: 1 });
        vi.mocked(listInvitations).mockResolvedValue({
            data: [
                {
                    company_id: 7,
                    company_name: "Nord Logistik",
                    role: "dispatcher",
                    invited_by_name: null,
                    created_at: "2026-10-28 09:00:00",
                },
            ],
        });
        vi.mocked(declineInvitation).mockResolvedValue(authUser({ invitations: 0 }));
        renderAuth(<AccountPage />, { user, route: "/konto#firmen" });

        fireEvent.click(
            await screen.findByRole("button", { name: "Einladung von Nord Logistik ablehnen" }),
        );

        expect(
            await screen.findByText("Einladung von Nord Logistik abgelehnt."),
        ).toBeInTheDocument();
        expect(declineInvitation).toHaveBeenCalledWith(7);
        expect(acceptInvitation).not.toHaveBeenCalled();
    });

    it("shows open invitations in the team and takes one back", async () => {
        const invited = {
            user_id: 5,
            name: "neu",
            email: "neu@example.com",
            role: "viewer" as const,
            invited: true,
        };
        vi.mocked(listMembers).mockResolvedValue({ data: [...members, invited] });
        vi.mocked(withdrawInvite).mockResolvedValue({ data: members });
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto#team" });

        const row = await memberRow("neu@example.com");
        expect(within(row).getByText("· Einladung offen", { exact: false })).toBeInTheDocument();
        expect(within(row).queryByRole("combobox")).toBeNull();
        expect(within(row).queryByRole("button", { name: "Entfernen" })).toBeNull();
        fireEvent.click(
            within(row).getByRole("button", { name: "Einladung an neu@example.com zurückziehen" }),
        );

        expect(
            await screen.findByText("Einladung an neu@example.com zurückgezogen."),
        ).toBeInTheDocument();
        expect(withdrawInvite).toHaveBeenCalledWith(5);
        expect(removeMember).not.toHaveBeenCalled();
    });

    it("shows the company log to a dispatcher", async () => {
        vi.mocked(listAudit).mockResolvedValue({
            data: [
                {
                    id: 2,
                    created_at: "2026-10-28 09:00:00",
                    action: "member_role_changed",
                    actor_name: "Cihan Kurt",
                    target_name: "Viewer",
                    target_email: "viewer@example.com",
                    details: { from: "viewer", to: "dispatcher" },
                },
                {
                    id: 1,
                    created_at: "2026-10-28 08:00:00",
                    action: "invite_created",
                    actor_name: "Cihan Kurt",
                    target_name: "neu",
                    target_email: "neu@example.com",
                    details: { role: "viewer" },
                },
            ],
            meta: { page: 1, limit: 50, total: 2, pageCount: 1 },
        });
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto#protokoll" });

        expect(
            await screen.findByText("Rolle von Viewer (viewer@example.com): Nur lesen → Dispatcher"),
        ).toBeInTheDocument();
        expect(screen.getByText("neu@example.com als Nur lesen eingeladen")).toBeInTheDocument();
        expect(listAudit).toHaveBeenCalledWith(1, expect.any(AbortSignal));
    });

    it("keeps the log away from a viewer", async () => {
        renderAuth(<AccountPage />, {
            user: authUser({ role: "viewer" }),
            route: "/konto#protokoll",
        });

        expect(await screen.findByRole("heading", { name: "Passwort ändern" })).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Protokoll" })).toBeNull();
        expect(listAudit).not.toHaveBeenCalled();
    });

    it("removes the own Google link", async () => {
        vi.mocked(getSsoProviders).mockResolvedValue({ google: true, microsoft: true });
        const next = authUser();
        vi.mocked(unlinkSso).mockResolvedValue(next);
        const { setUser } = renderAuth(<AccountPage />, {
            user: authUser({ sso_links: { google: true, microsoft: false } }),
            route: "/konto#anmeldung",
        });

        expect(await screen.findByText("Verknüpft")).toBeInTheDocument();
        expect(screen.getByText("Nicht verknüpft")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Microsoft verknüpfen" })).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Google trennen" }));

        expect(
            await screen.findByText("Google ist nicht mehr mit deinem Konto verknüpft."),
        ).toBeInTheDocument();
        expect(unlinkSso).toHaveBeenCalledWith("google");
        expect(setUser).toHaveBeenCalledWith(next);
    });

    it("says on its own section when Google or Microsoft was linked", async () => {
        vi.mocked(getSsoProviders).mockResolvedValue({ google: true, microsoft: false });
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto?sso=linked#anmeldung" });

        expect(
            await screen.findByText("Verknüpft. Du kannst dich jetzt auch damit anmelden."),
        ).toBeInTheDocument();
    });

    it("hides the section when the server has neither provider", async () => {
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto#passwort" });

        expect(await screen.findByRole("heading", { name: "Passwort ändern" })).toBeInTheDocument();
        await waitFor(() => expect(getSsoProviders).toHaveBeenCalled());
        expect(screen.queryByRole("link", { name: "Google und Microsoft" })).toBeNull();
    });

    it("adds a company domain and shows the record to create", async () => {
        vi.mocked(addDomain).mockResolvedValue({ data: {
                id: 3,
                domain: "rheinland.de",
                verified_at: null,
                record_name: "_fleet-live.rheinland.de",
                record_value: "fleet-live-verification=abc123",
            } });
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto#firmen-login" });

        const field = await screen.findByLabelText("Domain");
        fireEvent.change(field, { target: { value: "rheinland.de" } });
        submit("Eintragen");

        expect(
            await screen.findByText("rheinland.de eingetragen. Lege den TXT-Eintrag an und prüfe ihn dann."),
        ).toBeInTheDocument();
        expect(addDomain).toHaveBeenCalledWith("rheinland.de");
        expect(screen.getByText("_fleet-live.rheinland.de")).toBeInTheDocument();
        expect(screen.getByText("fleet-live-verification=abc123")).toBeInTheDocument();
    });

    it("checks a domain and shows it confirmed", async () => {
        vi.mocked(listDomains).mockResolvedValue({ data: [{
                id: 3,
                domain: "rheinland.de",
                verified_at: null,
                record_name: "_fleet-live.rheinland.de",
                record_value: "fleet-live-verification=abc123",
            }] });
        vi.mocked(verifyDomain).mockResolvedValue({
            data: [{ ...{
                id: 3,
                domain: "rheinland.de",
                verified_at: null,
                record_name: "_fleet-live.rheinland.de",
                record_value: "fleet-live-verification=abc123",
            }, verified_at: "2026-10-29 10:00:00" }],
        });
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto#firmen-login" });

        fireEvent.click(await screen.findByRole("button", { name: "rheinland.de prüfen" }));

        expect(await screen.findByText("Bestätigt")).toBeInTheDocument();
        expect(verifyDomain).toHaveBeenCalledWith(3);
        expect(screen.queryByRole("button", { name: "rheinland.de prüfen" })).toBeNull();
    });

    it("removes a domain", async () => {
        vi.mocked(listDomains).mockResolvedValue({ data: [{
                id: 3,
                domain: "rheinland.de",
                verified_at: null,
                record_name: "_fleet-live.rheinland.de",
                record_value: "fleet-live-verification=abc123",
            }] });
        vi.mocked(removeDomain).mockResolvedValue({ data: [] });
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto#firmen-login" });

        fireEvent.click(await screen.findByRole("button", { name: "rheinland.de entfernen" }));

        expect(await screen.findByText("rheinland.de entfernt.")).toBeInTheDocument();
        expect(removeDomain).toHaveBeenCalledWith(3);
    });

    it("saves the retention and says what was deleted", async () => {
        vi.mocked(getPrivacy).mockResolvedValue({ data: {
            viewer_driver_names: true,
            trips_days: null,
            alerts_days: null,
            audit_days: null,
            trips: 90,
            alerts: 90,
            audit: 365,
            defaults: { trips: 90, alerts: 90, audit: 365 },
        } });
        vi.mocked(savePrivacy).mockResolvedValue({
            data: { ...{
            viewer_driver_names: true,
            trips_days: null,
            alerts_days: null,
            audit_days: null,
            trips: 90,
            alerts: 90,
            audit: 365,
            defaults: { trips: 90, alerts: 90, audit: 365 },
        }, trips_days: 30, trips: 30 },
            deleted: { trips: 12, alerts: 0, audit: 1 },
        });
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto#datenschutz" });

        const trips = await screen.findByLabelText("Fahrten (Tage)");
        expect(screen.getByText("7–365 Tage · Standard 90 Tage")).toBeInTheDocument();
        fireEvent.change(trips, { target: { value: "30" } });
        submit("Aufbewahrung speichern");

        // Shorter means deleting at once: it asks first.
        const dialog = await screen.findByRole("dialog", {
            name: "Aufbewahrung verkürzen?",
            hidden: true,
        });
        expect(savePrivacy).not.toHaveBeenCalled();
        expect(within(dialog).getByText(/sofort gelöscht.*Fahrten./)).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole("button", { name: "Speichern und löschen" }));

        expect(
            await screen.findByText("Gespeichert. Gelöscht, weil älter: 12 Fahrten, 1 Protokoll-Eintrag."),
        ).toBeInTheDocument();
        expect(savePrivacy).toHaveBeenCalledWith({
            trips_days: 30,
            alerts_days: null,
            audit_days: null,
        });
    });

    it("keeps driver names to dispatchers with one switch", async () => {
        const settings = {
            viewer_driver_names: true,
            trips_days: null,
            alerts_days: null,
            audit_days: null,
            trips: 90,
            alerts: 90,
            audit: 365,
            defaults: { trips: 90, alerts: 90, audit: 365 },
        };
        vi.mocked(getPrivacy).mockResolvedValue({ data: settings });
        vi.mocked(savePrivacy).mockResolvedValue({
            data: { ...settings, viewer_driver_names: false },
            deleted: { trips: 0, alerts: 0, audit: 0 },
        });
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto#datenschutz" });

        const toggle = await screen.findByRole("checkbox", {
            name: "Viewer sehen Fahrernamen bei Verstößen",
        });
        expect(toggle).toBeChecked();
        fireEvent.click(toggle);

        expect(
            await screen.findByText("Fahrernamen sind jetzt Dispatchern vorbehalten."),
        ).toBeInTheDocument();
        expect(savePrivacy).toHaveBeenCalledWith({ viewer_driver_names: false });
        expect(toggle).not.toBeChecked();
    });

    it("saves nothing when shortening is cancelled", async () => {
        vi.mocked(getPrivacy).mockResolvedValue({
            data: {
                viewer_driver_names: true,
                trips_days: null,
                alerts_days: null,
                audit_days: null,
                trips: 90,
                alerts: 90,
                audit: 365,
                defaults: { trips: 90, alerts: 90, audit: 365 },
            },
        });
        vi.mocked(savePrivacy).mockReset();
        renderAuth(<AccountPage />, { user: authUser(), route: "/konto#datenschutz" });

        fireEvent.change(await screen.findByLabelText("Protokoll (Tage)"), {
            target: { value: "100" },
        });
        submit("Aufbewahrung speichern");
        const dialog = await screen.findByRole("dialog", {
            name: "Aufbewahrung verkürzen?",
            hidden: true,
        });
        fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));

        expect(savePrivacy).not.toHaveBeenCalled();
    });
});
