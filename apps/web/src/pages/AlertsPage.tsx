import { useLocation, useNavigate } from "react-router";

import { AlertTable } from "../components/alerts/AlertTable";
import { useAuth } from "../hooks/useAuth";
import { rememberVehicle } from "../api/vehicleCache";
import { setTelemetryFocus } from "../api/telemetryFocus";
import { getVehicle } from "../api/vehicles";

export const AlertsPage = () => {
    const { user } = useAuth();
    const canWrite = user?.role === "dispatcher";
    const navigate = useNavigate();
    const location = useLocation();

    return (
        <AlertTable
            canWrite={canWrite}
            onSelectAlert={(alert) => {
                void getVehicle(alert.vehicle_id)
                    .then((vehicle) => {
                        rememberVehicle(vehicle);
                    })
                    .catch(() => undefined);

                setTelemetryFocus("detail", [alert.vehicle_id]);
                navigate(`/vehicles/${alert.vehicle_id}`, {
                    state: {
                        from: `${location.pathname}${location.search}`,
                    },
                });
            }}
        />
    );
};
