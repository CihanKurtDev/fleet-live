import { Link, NavLink, Outlet, ScrollRestoration } from 'react-router';
import { VehiclesProvider } from './context/VehiclesProvider';
import { SimToggle } from './components/SimToggle';
import './App.css'

function App() {
    return (
        <VehiclesProvider>
            <header className="appHeader">
                <Link className="appBrand" to="/vehicles">fleet-live</Link>
                <nav className="appNav" aria-label="Hauptnavigation">
                    <NavLink to="/vehicles">Fahrzeuge</NavLink>
                    <NavLink to="/fleet" aria-label="Flottenkarte">Karte</NavLink>
                </nav>
                <SimToggle />
            </header>

            <main>
                <Outlet />
            </main>
            <ScrollRestoration />
        </VehiclesProvider>
    )
}

export default App
