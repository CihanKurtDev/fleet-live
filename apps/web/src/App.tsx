import { Link, Outlet } from 'react-router';
import { VehiclesProvider } from './context/VehiclesProvider';
import { SimToggle } from './components/SimToggle';
import './App.css'

function App() {
    return (
        <VehiclesProvider>
            <header className="appHeader">
                <Link to="/vehicles">fleet-live</Link>
                <SimToggle />
            </header>

            <main>
                <Outlet />
            </main>
        </VehiclesProvider>
    )
}

export default App
