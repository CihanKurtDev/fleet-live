import { createBrowserRouter, Outlet } from 'react-router';
import App from './App';
import layout from './styles/layout.module.scss';
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

function WideLayout() {
    return (
        <div className={layout.wide}>
            <Outlet />
        </div>
    );
}

function FullLayout() {
    return (
        <div className={layout.full} data-layout="full">
            <Outlet />
        </div>
    );
}

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
                        Component: WideLayout,
                        children: [
                            {
                                index: true,
                                lazy: async () => ({
                                    Component: (
                                        await import('./pages/BriefingPage')
                                    ).BriefingPage,
                                }),
                            },
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
