import { createBrowserRouter } from 'react-router';
import App from './App';
import { RequireAuth } from './components/RequireAuth';
import { LoginPage } from './pages/LoginPage';
import {
    NotFoundPage,
    RouteErrorPage,
} from './pages/RouteStatusPage';

export const router = createBrowserRouter([
    {
        path: '/',
        Component: App,
        ErrorBoundary: RouteErrorPage,
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
                        lazy: async () => ({
                            Component: (await import('./pages/BriefingPage'))
                                .BriefingPage,
                        }),
                    },
                    {
                        path: 'vehicles',
                        lazy: async () => ({
                            Component: (await import('./pages/VehiclesPage'))
                                .VehiclesPage,
                        }),
                    },
                    {
                        path: 'vehicles/import',
                        lazy: async () => ({
                            Component: (await import('./pages/ImportPage'))
                                .ImportPage,
                        }),
                    },
                    {
                        path: 'vehicles/:id',
                        lazy: async () => ({
                            Component: (
                                await import('./pages/VehicleDetailPage')
                            ).VehicleDetailPage,
                        }),
                    },
                    {
                        path: 'fleet',
                        lazy: async () => ({
                            Component: (await import('./pages/FleetPage'))
                                .FleetPage,
                        }),
                    },
                    {
                        path: 'alerts',
                        lazy: async () => ({
                            Component: (await import('./pages/AlertsPage'))
                                .AlertsPage,
                        }),
                    },
                    {
                        path: 'drivers',
                        lazy: async () => ({
                            Component: (await import('./pages/DriversPage'))
                                .DriversPage,
                        }),
                    },
                    {
                        path: 'drivers/:id',
                        lazy: async () => ({
                            Component: (
                                await import('./pages/DriverDetailPage')
                            ).DriverDetailPage,
                        }),
                    },
                ],
            },
            {
                path: '*',
                Component: NotFoundPage,
            },
        ],
    },
]);
