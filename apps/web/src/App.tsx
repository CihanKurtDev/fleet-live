import { Link, NavLink, Outlet, ScrollRestoration } from "react-router";
import { AuthProvider } from "./context/AuthProvider";
import { VehiclesProvider } from "./context/VehiclesProvider";
import { SimToggle } from "./components/SimToggle";
import { SessionMenu } from "./components/SessionMenu";
import "./App.css";

function App() {
    return (
        <AuthProvider>
            <VehiclesProvider>
                <header className="appHeader">
                    <Link className="appBrand" to="/vehicles">
                        fleet-live
                    </Link>
                    <nav className="appNav" aria-label="Hauptnavigation">
                        <NavLink to="/vehicles">Fahrzeuge</NavLink>
                        <NavLink to="/fleet" aria-label="Flottenkarte">
                            Karte
                        </NavLink>
                    </nav>
                    <SimToggle />
                    <SessionMenu />
                </header>

                <main>
                    <Outlet />
                </main>
                <ScrollRestoration />
            </VehiclesProvider>
        </AuthProvider>
    );
}

export default App;
