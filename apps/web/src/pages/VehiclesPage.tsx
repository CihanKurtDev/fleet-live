import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { VehicleInput } from "@fleet-live/shared";

import { VehicleTable } from "../components/vehicles/VehicleTable";
import { VehicleForm } from "../components/vehicles/VehicleForm";
import { Modal } from "../components/ui/Modal/Modal";
import { useVehicles } from "../context/vehiclesContext";
import { rememberVehicle } from "../api/vehicleCache";
import { setTelemetryFocus } from "../api/telemetryFocus";

export const VehiclesPage = () => {
    const { createVehicle, deleteVehicles } = useVehicles();
    const navigate = useNavigate();
    const location = useLocation();

    const [isCreateOpen, setIsCreateOpen] = useState(false);

    const handleCreate = async (input: VehicleInput) => {
        const errors = await createVehicle(input);

        if (errors) {
            return errors;
        }

        setIsCreateOpen(false);
    };

    return (
        <>
            <VehicleTable
                onDeleteVehicles={deleteVehicles}
                onAddVehicle={() => setIsCreateOpen(true)}
                onSelectVehicle={(vehicle) => {
                    rememberVehicle(vehicle);
                    setTelemetryFocus("detail", [vehicle.id]);
                    navigate(`/vehicles/${vehicle.id}`, {
                        state: {
                            from: `${location.pathname}${location.search}`,
                        },
                    });
                }}
            />

            <Modal
                open={isCreateOpen}
                onClose={() => setIsCreateOpen(false)}
                title="Fahrzeug anlegen"
            >
                <VehicleForm
                    submitLabel="Anlegen"
                    onSubmit={handleCreate}
                    onCancel={() => setIsCreateOpen(false)}
                />
            </Modal>
        </>
    );
};
