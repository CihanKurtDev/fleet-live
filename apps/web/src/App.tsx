import { Outlet, ScrollRestoration } from "react-router";
import { AuthProvider } from "./context/AuthProvider";
import { VehiclesProvider } from "./context/VehiclesProvider";
import { AppHeader, HeaderLiveStatus } from "./components/AppHeader";
import { useAuth } from "./hooks/useAuth";
import { useBriefing } from "./hooks/useBriefing";
import "./App.css";

/**
 * First tab stop: moves focus past the header to the page (WCAG 2.4.1).
 * Focus, not a #hash: /konto uses the hash for its sections.
 */
function SkipLink() {
    return (
        <a
            className="skip-link"
            href="#main"
            onClick={(event) => {
                event.preventDefault();
                document.getElementById("main")?.focus();
            }}
        >
            Zum Inhalt springen
        </a>
    );
}

function AuthedShell() {
    const { data } = useBriefing();

    return (
        <>
            <SkipLink />
            <AppHeader
                openAlertCount={data?.counts.open}
                status={<HeaderLiveStatus />}
            />
            <main id="main" tabIndex={-1}>
                <Outlet />
            </main>
            <ScrollRestoration />
        </>
    );
}

function GuestShell() {
    return (
        <>
            <SkipLink />
            <AppHeader />
            <main id="main" tabIndex={-1}>
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
