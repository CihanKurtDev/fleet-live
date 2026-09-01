import { createBrowserRouter, Navigate } from 'react-router';
import App from './App';
import { RequireAuth } from './components/RequireAuth';
import { VehiclesPage } from './pages/VehiclesPage';
import { VehicleDetailPage } from './pages/VehicleDetailPage';
import { FleetPage } from './pages/FleetPage';
import { AlertsPage } from './pages/AlertsPage';
import { DriversPage } from './pages/DriversPage';
import { DriverDetailPage } from './pages/DriverDetailPage';
import { LoginPage } from './pages/LoginPage';

export const router = createBrowserRouter([
    {
        path: '/',
        Component: App,
        children: [
            {
                path: 'login',
                Component: LoginPage,
            },
            {
                Component: RequireAuth,
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
                    {
                        path: 'alerts',
                        Component: AlertsPage,
                    },
                    {
                        path: 'drivers',
                        Component: DriversPage,
                    },
                    {
                        path: 'drivers/:id',
                        Component: DriverDetailPage,
                    },
                ],
            },
        ],
    },
]);
