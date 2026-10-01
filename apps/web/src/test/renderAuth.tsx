import { render, type RenderOptions } from "@testing-library/react";
import type { AuthUser } from "@fleet-live/shared";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { AuthContext } from "../context/authContext";

export const authUser = (overrides: Partial<AuthUser> = {}): AuthUser => ({
    id: 1,
    name: "Cihan Kurt",
    email: "cihan@example.com",
    company_id: 1,
    company_name: "Rheinland Logistik",
    role: "dispatcher",
    memberships: [
        {
            company_id: 1,
            company_name: "Rheinland Logistik",
            role: "dispatcher",
        },
    ],
    totp_enabled: false,
    import_prompt: false,
    ...overrides,
});

export const renderAuth = (
    ui: ReactElement,
    {
        user = null,
        route = "/",
        setUser = vi.fn(),
    }: {
        user?: AuthUser | null;
        route?: string;
        setUser?: (next: AuthUser | null) => void;
    } = {},
    options?: Omit<RenderOptions, "wrapper">,
) => {
    const wrapper = ({ children }: { children: ReactNode }) => (
        <AuthContext.Provider value={{ user, isReady: true, setUser }}>
            <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
        </AuthContext.Provider>
    );

    return { setUser, ...render(ui, { wrapper, ...options }) };
};
