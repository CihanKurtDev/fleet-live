import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../hooks/useAuth";
import styles from "./RequireAuth.module.scss";

export const RequireAuth = () => {
    const { user, isReady } = useAuth();
    const location = useLocation();

    if (!isReady) {
        return (
            <p className={styles.loading} role="status" aria-live="polite">
                Sitzung wird geladen…
            </p>
        );
    }

    if (!user) {
        return <Navigate to="/login" replace state={{ from: location }} />;
    }

    return <Outlet />;
};
