import { lazy, Suspense } from "react";

import { useAuth } from "../hooks/useAuth";
import layout from "../styles/layout.module.scss";
import requireAuth from "../components/RequireAuth.module.scss";

const LandingPage = lazy(async () => ({
    default: (await import("./LandingPage")).LandingPage,
}));
const BriefingPage = lazy(async () => ({
    default: (await import("./BriefingPage")).BriefingPage,
}));

const Loading = () => (
    <p className={requireAuth.loading} role="status" aria-live="polite">
        Wird geladen…
    </p>
);

/**
 * `/` is the public landing page for visitors and Schicht once signed in.
 * Every other app route stays behind `RequireAuth`.
 */
export const HomeRoute = () => {
    const { user, isReady } = useAuth();

    if (!isReady) {
        return <Loading />;
    }

    if (!user) {
        return (
            <Suspense fallback={<Loading />}>
                <LandingPage />
            </Suspense>
        );
    }

    return (
        <div className={layout.wide}>
            <Suspense fallback={<Loading />}>
                <BriefingPage />
            </Suspense>
        </div>
    );
};
