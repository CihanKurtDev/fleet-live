import { createBrowserRouter } from 'react-router';
import App from './App';
import { RequireAuth } from './components/RequireAuth';
import { FullLayout, WideLayout } from './components/RouteLayouts';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { HomeRoute } from './pages/HomeRoute';
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
                // Landing page for visitors, Schicht once signed in.
                index: true,
                Component: HomeRoute,
            },
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
                        Component: WideLayout,
                        children: [
                            {
                                path: 'vehicles',
                                lazy: async () => ({
                                    Component: (
                                        await import('./pages/VehiclesPage')
                                    ).VehiclesPage,
                                }),
                            },
                            {
                                path: 'vehicles/import',
                                lazy: async () => ({
                                    Component: (
                                        await import('./pages/ImportPage')
                                    ).ImportPage,
                                }),
                            },
                            {
                                path: 'vehicles/:id',
                                lazy: async () => ({
                                    Component: (
                                        await import(
                                            './pages/VehicleDetailPage'
                                        )
                                    ).VehicleDetailPage,
                                }),
                            },
                            {
                                path: 'alerts',
                                lazy: async () => ({
                                    Component: (
                                        await import('./pages/AlertsPage')
                                    ).AlertsPage,
                                }),
                            },
                            {
                                path: 'fristen',
                                lazy: async () => ({
                                    Component: (
                                        await import('./pages/DuePage')
                                    ).DuePage,
                                }),
                            },
                            {
                                path: 'drivers',
                                lazy: async () => ({
                                    Component: (
                                        await import('./pages/DriversPage')
                                    ).DriversPage,
                                }),
                            },
                            {
                                path: 'drivers/:id',
                                lazy: async () => ({
                                    Component: (
                                        await import(
                                            './pages/DriverDetailPage'
                                        )
                                    ).DriverDetailPage,
                                }),
                            },
                            {
                                path: 'konto',
                                lazy: async () => ({
                                    Component: (
                                        await import('./pages/AccountPage')
                                    ).AccountPage,
                                }),
                            },
                        ],
                    },
                    {
                        Component: FullLayout,
                        children: [
                            {
                                path: 'fleet',
                                lazy: async () => ({
                                    Component: (
                                        await import('./pages/FleetPage')
                                    ).FleetPage,
                                }),
                            },
                        ],
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
