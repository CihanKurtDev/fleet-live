import { createBrowserRouter, Navigate } from 'react-router';
import App from './App';
import { VehiclesPage } from './pages/VehiclesPage';
import { VehicleDetailPage } from './pages/VehicleDetailPage';
import { FleetPage } from './pages/FleetPage';

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
            {
                path: 'fleet',
                Component: FleetPage,
            },
        ],
    },
]);
