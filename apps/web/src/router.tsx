import { createBrowserRouter } from 'react-router';
import App from './App';
import { RequireAuth } from './components/RequireAuth';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
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
                path: 'registrieren',
                Component: RegisterPage,
            },
            {
                path: 'passwort-vergessen',
                Component: ForgotPasswordPage,
            },
            {
                path: 'passwort-zuruecksetzen',
                Component: ResetPasswordPage,
            },
            {
                path: 'email-bestaetigen',
                Component: VerifyEmailPage,
            },
            {
                path: 'einladung',
                Component: AcceptInvitePage,
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
                        path: 'konto',
                        lazy: async () => ({
                            Component: (await import('./pages/AccountPage'))
                                .AccountPage,
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
