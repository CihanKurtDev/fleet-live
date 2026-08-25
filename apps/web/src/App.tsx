import type { VehicleTableRow } from '@fleet-live/shared';
import './App.css'
import { VehicleTable } from './components/vehicles/VehicleTable';

const mockVehicles: VehicleTableRow[] = [
    {
        id: 1,
        license_plate: "K-AB 123",
        driver_name: "Max Mustermann",
        fuel_level: 82,
        status: "DRIVING",
        speed: 64,
        activeAlerts: 0,
    },
    {
        id: 2,
        license_plate: "K-CD 456",
        driver_name: "Erika Musterfrau",
        fuel_level: 31,
        status: "IDLE",
        speed: 0,
        activeAlerts: 2,
    },
    {
        id: 3,
        license_plate: "K-EF 789",
        driver_name: "John Doe",
        fuel_level: 7,
        status: "OFFLINE",
        speed: null,
        activeAlerts: 1,
    },
];
function App() {

  return (
    <main>
      <VehicleTable vehicles={mockVehicles} />
    </main>
  )
}

export default App
