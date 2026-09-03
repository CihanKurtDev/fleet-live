import { createBrowserRouter } from 'react-router';
import App from './App';
import { RequireAuth } from './components/RequireAuth';
import { BriefingPage } from './pages/BriefingPage';
import { VehiclesPage } from './pages/VehiclesPage';
import { VehicleDetailPage } from './pages/VehicleDetailPage';
import { FleetPage } from './pages/FleetPage';
import { AlertsPage } from './pages/AlertsPage';
import { DriversPage } from './pages/DriversPage';
import { DriverDetailPage } from './pages/DriverDetailPage';
import { LoginPage } from './pages/LoginPage';
import { HeaderPreviewPage } from './pages/HeaderPreviewPage';

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
                path: '__header-preview',
                Component: HeaderPreviewPage,
            },
            {
                Component: RequireAuth,
                children: [
                    {
                        index: true,
                        Component: BriefingPage,
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
