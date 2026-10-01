import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@fleet-live/shared";

import { ApiError } from "../api/client";
import { AuthContext } from "../context/authContext";
import { AcceptInvitePage } from "../pages/AcceptInvitePage";
import { ForgotPasswordPage } from "../pages/ForgotPasswordPage";
import { LoginPage } from "../pages/LoginPage";
import { RegisterPage } from "../pages/RegisterPage";
import { ResetPasswordPage } from "../pages/ResetPasswordPage";
import { VerifyEmailPage } from "../pages/VerifyEmailPage";
import { authUser, renderAuth } from "./renderAuth";

vi.mock("qrcode", () => ({
    default: {
        toDataURL: vi.fn(async () => "data:image/png;base64,qr"),
    },
}));

vi.mock("../api/auth", () => ({
    login: vi.fn(),
    resendVerification: vi.fn(),
    setupTotp: vi.fn(),
    confirmTotp: vi.fn(),
    registerAccount: vi.fn(),
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
    verifyEmail: vi.fn(),
    acceptInvite: vi.fn(),
    getSsoProviders: vi.fn(),
}));

import {
    acceptInvite,
    confirmTotp,
    forgotPassword,
    getSsoProviders,
    login,
    registerAccount,
    resendVerification,
    resetPassword,
    setupTotp,
    verifyEmail,
} from "../api/auth";

const submit = (name: string) => {
    const button = screen.getByRole("button", { name });
    const form = button.closest("form");

    if (!form) {
        throw new Error(`Kein Formular für ${name}`);
    }

    fireEvent.submit(form);
};

const renderLogin = (
    entry: string | { pathname: string; state?: unknown } = "/login",
    user: AuthUser | null = null,
) => {
    const setUser = vi.fn();
    const router = createMemoryRouter(
        [
            { path: "/login", element: <LoginPage /> },
            { path: "/", element: <p>Schicht</p> },
            { path: "/fleet", element: <p>Flottenkarte</p> },
            { path: "/registrieren", element: <p>Registrierungsseite</p> },
            { path: "/passwort-vergessen", element: <p>Vergessen-Seite</p> },
        ],
        { initialEntries: [entry] },
    );

    render(
        <AuthContext.Provider value={{ user, isReady: true, setUser }}>
            <RouterProvider router={router} />
        </AuthContext.Provider>,
    );

    return { setUser };
};

describe("login page", () => {
    beforeEach(() => {
        vi.mocked(login).mockReset();
        vi.mocked(resendVerification).mockReset();
        vi.mocked(setupTotp).mockReset();
        vi.mocked(confirmTotp).mockReset();
        vi.mocked(getSsoProviders).mockResolvedValue({
            google: false,
            microsoft: false,
        });
    });

    it("links to registration and password reset", () => {
        renderLogin();

        expect(screen.getByLabelText("Passwort")).toHaveAttribute(
            "minLength",
            "12",
        );
        expect(screen.getByLabelText("Passwort")).toHaveAttribute(
            "maxLength",
            "128",
        );
        expect(
            screen.getByRole("link", { name: "Firma registrieren" }),
        ).toHaveAttribute("href", "/registrieren");
        expect(
            screen.getByRole("link", { name: "Passwort vergessen" }),
        ).toHaveAttribute("href", "/passwort-vergessen");
        expect(
            screen.queryByRole("link", { name: "Mit Google" }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("link", { name: "Mit Microsoft" }),
        ).not.toBeInTheDocument();
    });

    it("shows Google and Microsoft only when the API reports them as configured", async () => {
        vi.mocked(getSsoProviders).mockResolvedValue({
            google: true,
            microsoft: true,
        });
        renderLogin();

        expect(
            await screen.findByRole("link", { name: "Mit Google" }),
        ).toHaveAttribute("href", "/api/auth/sso/google/start");
        expect(
            screen.getByRole("link", { name: "Mit Microsoft" }),
        ).toHaveAttribute("href", "/api/auth/sso/microsoft/start");
    });

    it("fills the demo dispatcher account", () => {
        renderLogin();

        fireEvent.click(
            screen.getByRole("button", { name: "Dispatcher übernehmen" }),
        );

        expect(screen.getByLabelText("E-Mail")).toHaveValue("cihan@example.com");
        expect(screen.getByLabelText("Passwort")).toHaveValue(
            "development-only-password",
        );
    });

    it("opens a session and returns to the requested page", async () => {
        const signedIn = authUser();
        vi.mocked(login).mockResolvedValue(signedIn);
        const { setUser } = renderLogin({
            pathname: "/login",
            state: { from: { pathname: "/fleet", search: "?bbox=1" } },
        });

        fireEvent.change(screen.getByLabelText("E-Mail"), {
            target: { value: "cihan@example.com" },
        });
        fireEvent.change(screen.getByLabelText("Passwort"), {
            target: { value: "development-only-password" },
        });
        submit("Anmelden");

        expect(await screen.findByText("Flottenkarte")).toBeInTheDocument();
        expect(login).toHaveBeenCalledWith({
            email: "cihan@example.com",
            password: "development-only-password",
            remember: true,
        });
        expect(setUser).toHaveBeenCalledWith(signedIn);
    });

    it("shows a field error without a second banner", async () => {
        vi.mocked(login).mockRejectedValue(
            new ApiError("Prüfe die Eingaben.", 400, {
                email: "E-Mail ist ungültig.",
            }),
        );
        renderLogin();

        fireEvent.change(screen.getByLabelText("E-Mail"), {
            target: { value: "kaputt" },
        });
        fireEvent.change(screen.getByLabelText("Passwort"), {
            target: { value: "development-only-password" },
        });
        submit("Anmelden");

        expect(await screen.findByText("E-Mail ist ungültig.")).toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("offers to resend the confirmation mail", async () => {
        vi.mocked(login).mockRejectedValue(
            new ApiError(
                "Bestätige zuerst die E-Mail.",
                403,
                undefined,
                "EMAIL_UNVERIFIED",
            ),
        );
        vi.mocked(resendVerification).mockResolvedValue({
            delivery: "log",
            message: "Der Link steht im API-Log.",
        });
        renderLogin();

        fireEvent.change(screen.getByLabelText("E-Mail"), {
            target: { value: "neu@example.com" },
        });
        fireEvent.change(screen.getByLabelText("Passwort"), {
            target: { value: "development-only-password" },
        });
        submit("Anmelden");

        expect(
            await screen.findByRole("alert"),
        ).toHaveTextContent("Bestätige zuerst die E-Mail.");
        fireEvent.click(
            screen.getByRole("button", {
                name: "Bestätigungsmail erneut senden",
            }),
        );

        expect(
            await screen.findByText("Der Link steht im API-Log."),
        ).toBeInTheDocument();
        expect(resendVerification).toHaveBeenCalledWith("neu@example.com");
    });

    it("offers the company login when the membership requires it", async () => {
        vi.mocked(login).mockRejectedValue(
            new ApiError(
                "Diese Firma verlangt den Firmen-Login.",
                403,
                undefined,
                "SSO_REQUIRED",
                { sso_company_id: 4 },
            ),
        );
        renderLogin();

        fireEvent.change(screen.getByLabelText("E-Mail"), {
            target: { value: "cihan@example.com" },
        });
        fireEvent.change(screen.getByLabelText("Passwort"), {
            target: { value: "development-only-password" },
        });
        submit("Anmelden");

        const button = await screen.findByRole("button", {
            name: "Mit Firmen-Login anmelden",
        });
        const assigned: string[] = [];
        const realLocation = window.location;
        const locationSpy = vi
            .spyOn(window, "location", "get")
            .mockImplementation(
                () =>
                    new Proxy(realLocation, {
                        set(target, property, value) {
                            if (property === "href") {
                                assigned.push(String(value));
                                return true;
                            }

                            return Reflect.set(target, property, value);
                        },
                    }) as Location,
            );
        fireEvent.click(button);
        locationSpy.mockRestore();

        expect(assigned).toEqual([
            "/api/auth/sso/company/start?company_id=4",
        ]);
    });

    it("asks for a second factor before opening the session", async () => {
        vi.mocked(login).mockResolvedValue({
            step: "totp",
            challenge: "challenge-1",
        });
        vi.mocked(confirmTotp).mockResolvedValue(authUser());
        const { setUser } = renderLogin();

        fireEvent.change(screen.getByLabelText("E-Mail"), {
            target: { value: "cihan@example.com" },
        });
        fireEvent.change(screen.getByLabelText("Passwort"), {
            target: { value: "development-only-password" },
        });
        submit("Anmelden");

        expect(
            await screen.findByText(
                "Gib den Code aus der Authenticator-App oder einen Wiederherstellungscode ein.",
            ),
        ).toBeInTheDocument();
        expect(screen.queryByLabelText("E-Mail")).not.toBeInTheDocument();
        expect(setUser).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText("Code"), {
            target: { value: "123456" },
        });
        submit("Anmelden");

        expect(await screen.findByText("Schicht")).toBeInTheDocument();
        expect(confirmTotp).toHaveBeenCalledWith({
            challenge: "challenge-1",
            code: "123456",
        });
    });

    it("shows the enrollment QR when the company requires a second factor", async () => {
        vi.mocked(login).mockResolvedValue({
            step: "totp_enroll",
            challenge: "enroll-1",
        });
        vi.mocked(setupTotp).mockResolvedValue({
            secret: "SECRET",
            otpauth_url: "otpauth://totp/fleet",
        });
        renderLogin();

        fireEvent.change(screen.getByLabelText("E-Mail"), {
            target: { value: "cihan@example.com" },
        });
        fireEvent.change(screen.getByLabelText("Passwort"), {
            target: { value: "development-only-password" },
        });
        submit("Anmelden");

        expect(await screen.findByText("Geheimnis: SECRET")).toBeInTheDocument();
        expect(
            screen.getByAltText("QR-Code für die Authenticator-App"),
        ).toHaveAttribute("src", "data:image/png;base64,qr");
        expect(setupTotp).toHaveBeenCalledWith("enroll-1");
    });

    it("explains a missing identity-provider configuration", () => {
        renderLogin("/login?sso=unconfigured");

        expect(screen.getByRole("alert")).toHaveTextContent(
            "Dieser Login ist hier nicht konfiguriert.",
        );
    });

    it("sends an already signed-in person to the app", async () => {
        renderLogin("/login", authUser());

        expect(await screen.findByText("Schicht")).toBeInTheDocument();
    });
});

describe("register page", () => {
    beforeEach(() => {
        vi.mocked(registerAccount).mockReset();
    });

    it("shows the mail message and does not open a session", async () => {
        vi.mocked(registerAccount).mockResolvedValue({
            delivery: "log",
            message: "Der Bestätigungslink steht im API-Log.",
        });
        renderAuth(<RegisterPage />);

        fireEvent.change(screen.getByLabelText("Firmenname"), {
            target: { value: "Nord Logistik" },
        });
        fireEvent.change(screen.getByLabelText("Dein Name"), {
            target: { value: "Ada" },
        });
        fireEvent.change(screen.getByLabelText("E-Mail"), {
            target: { value: "ada@example.com" },
        });
        fireEvent.change(screen.getByLabelText("Passwort"), {
            target: { value: "development-only-password" },
        });
        expect(screen.getByLabelText("Passwort")).toHaveAttribute(
            "minLength",
            "12",
        );
        submit("Registrieren");

        expect(
            await screen.findByText("Der Bestätigungslink steht im API-Log."),
        ).toBeInTheDocument();
        expect(screen.queryByLabelText("Firmenname")).not.toBeInTheDocument();
        expect(registerAccount).toHaveBeenCalledWith({
            company_name: "Nord Logistik",
            name: "Ada",
            email: "ada@example.com",
            password: "development-only-password",
        });
    });

    it("shows a company-name field error", async () => {
        vi.mocked(registerAccount).mockRejectedValue(
            new ApiError("Diese Firma gibt es schon.", 409, {
                company_name: "Dieser Firmenname ist vergeben.",
            }),
        );
        renderAuth(<RegisterPage />);

        fireEvent.change(screen.getByLabelText("Firmenname"), {
            target: { value: "Rheinland Logistik" },
        });
        fireEvent.change(screen.getByLabelText("Dein Name"), {
            target: { value: "Ada" },
        });
        fireEvent.change(screen.getByLabelText("E-Mail"), {
            target: { value: "ada@example.com" },
        });
        fireEvent.change(screen.getByLabelText("Passwort"), {
            target: { value: "development-only-password" },
        });
        submit("Registrieren");

        expect(
            await screen.findByText("Dieser Firmenname ist vergeben."),
        ).toBeInTheDocument();
        expect(screen.getByRole("alert")).toHaveTextContent(
            "Diese Firma gibt es schon.",
        );
    });
});

describe("forgot password page", () => {
    it("shows the same confirmation the API returns", async () => {
        vi.mocked(forgotPassword).mockResolvedValue({
            delivery: "log",
            message:
                "Wenn ein Konto mit Passwort existiert, gibt es einen Reset-Link. Ein Mailversand ist nicht eingerichtet — der Link steht im Server-Log, nicht im Posteingang.",
        });
        renderAuth(<ForgotPasswordPage />);

        fireEvent.change(screen.getByLabelText("E-Mail"), {
            target: { value: "unbekannt@example.com" },
        });
        submit("Link anfordern");

        expect(
            await screen.findByRole("status"),
        ).toHaveTextContent("nicht im Posteingang");
        expect(screen.queryByLabelText("E-Mail")).not.toBeInTheDocument();
    });
});

describe("reset password page", () => {
    it("rejects a link without a token", () => {
        renderAuth(<ResetPasswordPage />, {
            route: "/passwort-zuruecksetzen",
        });

        expect(screen.getByRole("alert")).toHaveTextContent(
            "Der Link ist ungültig oder abgelaufen.",
        );
        expect(
            screen.getByRole("button", { name: "Passwort setzen" }),
        ).toBeDisabled();
    });

    it("sets the password from the token", async () => {
        vi.mocked(resetPassword).mockResolvedValue(undefined);
        renderAuth(<ResetPasswordPage />, {
            route: "/passwort-zuruecksetzen?token=reset-token",
        });

        expect(screen.getByLabelText("Neues Passwort")).toHaveAttribute(
            "maxLength",
            "128",
        );
        fireEvent.change(screen.getByLabelText("Neues Passwort"), {
            target: { value: "development-only-password" },
        });
        submit("Passwort setzen");

        expect(
            await screen.findByText(
                "Das Passwort ist gesetzt. Du kannst dich anmelden.",
            ),
        ).toBeInTheDocument();
        expect(resetPassword).toHaveBeenCalledWith(
            "reset-token",
            "development-only-password",
        );
    });
});

describe("verify email page", () => {
    it("confirms the address from the link", async () => {
        vi.mocked(verifyEmail).mockResolvedValue(undefined);
        renderAuth(<VerifyEmailPage />, {
            route: "/email-bestaetigen?token=verify-token",
        });

        expect(
            await screen.findByText(
                "Die E-Mail ist bestätigt. Du kannst dich anmelden.",
            ),
        ).toBeInTheDocument();
        expect(verifyEmail).toHaveBeenCalledWith("verify-token");
    });

    it("explains a link without a token", () => {
        renderAuth(<VerifyEmailPage />, { route: "/email-bestaetigen" });

        expect(
            screen.getByText("Der Link ist ungültig oder abgelaufen."),
        ).toBeInTheDocument();
        expect(verifyEmail).not.toHaveBeenCalled();
    });
});

describe("accept invite page", () => {
    it("opens a session after the password is set", async () => {
        const signedIn = authUser({
            email: "neu@example.com",
            role: "viewer",
        });
        vi.mocked(acceptInvite).mockResolvedValue(signedIn);
        const setUser = vi.fn();
        const router = createMemoryRouter(
            [
                { path: "/einladung", element: <AcceptInvitePage /> },
                { path: "/", element: <p>Schicht</p> },
            ],
            { initialEntries: ["/einladung?token=invite-token"] },
        );

        render(
            <AuthContext.Provider
                value={{ user: null, isReady: true, setUser }}
            >
                <RouterProvider router={router} />
            </AuthContext.Provider>,
        );

        fireEvent.change(screen.getByLabelText("Name"), {
            target: { value: "Neu" },
        });
        fireEvent.change(screen.getByLabelText("Passwort"), {
            target: { value: "development-only-password" },
        });
        submit("Einladung annehmen");

        expect(await screen.findByText("Schicht")).toBeInTheDocument();
        expect(acceptInvite).toHaveBeenCalledWith({
            token: "invite-token",
            name: "Neu",
            password: "development-only-password",
        });
        expect(setUser).toHaveBeenCalledWith(signedIn);
    });

    it("rejects a link without a token", () => {
        renderAuth(<AcceptInvitePage />, { route: "/einladung" });

        expect(screen.getByRole("alert")).toHaveTextContent(
            "Der Link ist ungültig oder abgelaufen.",
        );
        expect(
            screen.getByRole("button", { name: "Einladung annehmen" }),
        ).toBeDisabled();
    });
});
