import { Link, NavLink, Outlet, ScrollRestoration } from "react-router";
import { AuthProvider } from "./context/AuthProvider";
import { VehiclesProvider } from "./context/VehiclesProvider";
import { SimToggle } from "./components/SimToggle";
import { SessionMenu } from "./components/SessionMenu";
import { useAuth } from "./hooks/useAuth";
import { useBriefing } from "./hooks/useBriefing";
import { formatCount } from "./utils/formatCount";
import "./App.css";

function AppHeader({ openAlertCount }: { openAlertCount?: number }) {
    const { user } = useAuth();

    return (
        <header className="appHeader">
            <Link className="appBrand" to={user ? "/" : "/login"}>
                fleet-live
            </Link>
            {user && (
                <nav className="appNav" aria-label="Hauptnavigation">
                    <NavLink to="/vehicles">Fahrzeuge</NavLink>
                    <NavLink to="/fleet" aria-label="Flottenkarte">
                        Karte
                    </NavLink>
                    <NavLink to="/alerts">
                        Warnungen
                        {openAlertCount !== undefined && openAlertCount > 0 ? (
                            <span className="appNavBadge">
                                {formatCount(openAlertCount)}
                            </span>
                        ) : null}
                    </NavLink>
                    <NavLink to="/drivers">Fahrer</NavLink>
                </nav>
            )}
            {user && user.role === "dispatcher" && <SimToggle />}
            <SessionMenu />
        </header>
    );
}

function AuthedShell() {
    const { data } = useBriefing();

    return (
        <>
            <AppHeader openAlertCount={data?.counts.open} />
            <main>
                <Outlet />
            </main>
            <ScrollRestoration />
        </>
    );
}

function GuestShell() {
    return (
        <>
            <AppHeader />
            <main>
                <Outlet />
            </main>
            <ScrollRestoration />
        </>
    );
}

function AppShell() {
    const { user } = useAuth();

    if (!user) {
        return <GuestShell />;
    }

    return (
        <VehiclesProvider>
            <AuthedShell />
        </VehiclesProvider>
    );
}

function App() {
    return (
        <AuthProvider>
            <AppShell />
        </AuthProvider>
    );
}

export default App;
