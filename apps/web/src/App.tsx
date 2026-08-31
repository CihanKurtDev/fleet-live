import { Link, NavLink, Outlet, ScrollRestoration } from "react-router";
import { AuthProvider } from "./context/AuthProvider";
import { SimToggle } from "./components/SimToggle";
import { SessionMenu } from "./components/SessionMenu";
import { useAuth } from "./hooks/useAuth";
import "./App.css";

function AppShell() {
    const { user } = useAuth();

    return (
        <>
            <header className="appHeader">
                <Link className="appBrand" to="/vehicles">
                    fleet-live
                </Link>
                {user && (
                    <nav className="appNav" aria-label="Hauptnavigation">
                        <NavLink to="/vehicles">Fahrzeuge</NavLink>
                        <NavLink to="/fleet" aria-label="Flottenkarte">
                            Karte
                        </NavLink>
                    </nav>
                )}
                {user && user.role === "dispatcher" && <SimToggle />}
                <SessionMenu />
            </header>

            <main>
                <Outlet />
            </main>
            <ScrollRestoration />
        </>
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
