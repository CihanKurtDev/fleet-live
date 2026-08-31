import { Navigate, Outlet, useLocation } from "react-router";
import { VehiclesProvider } from "../context/VehiclesProvider";
import { useAuth } from "../hooks/useAuth";

export const RequireAuth = () => {
    const { user, isReady } = useAuth();
    const location = useLocation();

    if (!isReady) {
        return null;
    }

    if (!user) {
        return <Navigate to="/login" replace state={{ from: location }} />;
    }

    return (
        <VehiclesProvider>
            <Outlet />
        </VehiclesProvider>
    );
};
