import { render, screen } from "@testing-library/react";
import {
    createMemoryRouter,
    MemoryRouter,
    Outlet,
    Route,
    RouterProvider,
    Routes,
    useLocation,
} from "react-router";
import { describe, expect, it, vi } from "vitest";

import { RequireAuth } from "../components/RequireAuth";
import {
    NotFoundPage,
    RouteErrorPage,
} from "../pages/RouteStatusPage";
import { AuthContext } from "../context/authContext";

const LoginProbe = () => {
    const location = useLocation();
    const from = location.state?.from as
        | { pathname: string; search: string }
        | undefined;

    return (
        <p>
            Login · {from ? `${from.pathname}${from.search}` : "kein Ziel"}
        </p>
    );
};

describe("protected routing", () => {
    it("keeps the deep link when redirecting to login", async () => {
        render(
            <AuthContext.Provider
                value={{ user: null, isReady: true, setUser: vi.fn() }}
            >
                <MemoryRouter initialEntries={["/vehicles/17?archive=2"]}>
                    <Routes>
                        <Route path="/login" element={<LoginProbe />} />
                        <Route element={<RequireAuth />}>
                            <Route
                                path="/vehicles/:id"
                                element={<p>Geschützt</p>}
                            />
                        </Route>
                    </Routes>
                </MemoryRouter>
            </AuthContext.Provider>,
        );

        expect(
            await screen.findByText("Login · /vehicles/17?archive=2"),
        ).toBeInTheDocument();
        expect(screen.queryByText("Geschützt")).not.toBeInTheDocument();
    });

    it("shows an accessible loading state before auth is ready", () => {
        render(
            <AuthContext.Provider
                value={{ user: null, isReady: false, setUser: vi.fn() }}
            >
                <MemoryRouter>
                    <RequireAuth />
                </MemoryRouter>
            </AuthContext.Provider>,
        );

        expect(screen.getByRole("status")).toHaveTextContent(
            "Sitzung wird geladen",
        );
    });
});

describe("route status pages", () => {
    it("renders a useful not-found page", () => {
        render(
            <MemoryRouter>
                <NotFoundPage />
            </MemoryRouter>,
        );

        expect(
            screen.getByRole("heading", { name: "Seite nicht gefunden" }),
        ).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Zur Schicht" })).toHaveAttribute(
            "href",
            "/",
        );
    });

    it("renders the route error boundary", async () => {
        const router = createMemoryRouter(
            [
                {
                    path: "/",
                    Component: Outlet,
                    ErrorBoundary: RouteErrorPage,
                    children: [
                        {
                            index: true,
                            loader: () => {
                                throw new Error("kaputt");
                            },
                            Component: () => <p>Inhalt</p>,
                        },
                    ],
                },
            ],
            { initialEntries: ["/"] },
        );

        render(<RouterProvider router={router} />);

        expect(
            await screen.findByRole("heading", {
                name: "Seite konnte nicht geladen werden",
            }),
        ).toBeInTheDocument();
    });
});
