import { Outlet, ScrollRestoration } from "react-router";
import { AuthProvider } from "./context/AuthProvider";
import { VehiclesProvider } from "./context/VehiclesProvider";
import { AppHeader } from "./components/AppHeader";
import { useAuth } from "./hooks/useAuth";
import { useBriefing } from "./hooks/useBriefing";
import "./App.css";

function AuthedShell() {
    const { data } = useBriefing();

    return (
        <>
            <AppHeader openAlertCount={data?.counts.open} />
            <main>
                <Outlet />
            </main>
            <ScrollRestoration />
        </>
    );
}

function GuestShell() {
    return (
        <>
            <AppHeader />
            <main>
                <Outlet />
            </main>
            <ScrollRestoration />
        </>
    );
}

function AppShell() {
    const { user } = useAuth();

    if (!user) {
        return <GuestShell />;
    }

    return (
        <VehiclesProvider>
            <AuthedShell />
        </VehiclesProvider>
    );
}

function App() {
    return (
        <AuthProvider>
            <AppShell />
        </AuthProvider>
    );
}

export default App;
