import { createBrowserRouter, Navigate } from 'react-router';
import App from './App';
import { VehiclesPage } from './pages/VehiclesPage';
import { VehicleDetailPage } from './pages/VehicleDetailPage';

// Noch ohne Loader. Sobald die API angebunden ist, können die
// Routen hier um loader/action ergänzt werden, ohne die Seiten umzubauen.
export const router = createBrowserRouter([
    {
        path: '/',
        Component: App,
        children: [
            {
                index: true,
                element: <Navigate to="/vehicles" replace />,
            },
            {
                path: 'vehicles',
                Component: VehiclesPage,
            },
            {
                path: 'vehicles/:id',
                Component: VehicleDetailPage,
            },
        ],
    },
]);
