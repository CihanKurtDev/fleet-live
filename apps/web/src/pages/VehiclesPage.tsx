import { useState } from "react";
import { useNavigate } from "react-router";
import type { VehicleInput } from "@fleet-live/shared";

import { VehicleTable } from "../components/vehicles/VehicleTable";
import { VehicleForm } from "../components/vehicles/VehicleForm";
import { Modal } from "../components/ui/Modal/Modal";
import { useVehicles } from "../context/vehiclesContext";

export const VehiclesPage = () => {
    const { vehicles, createVehicle, deleteVehicles } =
        useVehicles();
    const navigate = useNavigate();

    const [isCreateOpen, setIsCreateOpen] = useState(false);

    const handleCreate = (input: VehicleInput) => {
        const errors = createVehicle(input);

        if (errors) {
            return errors;
        }

        setIsCreateOpen(false);
    };

    return (
        <>
            <VehicleTable
                vehicles={vehicles}
                onDeleteVehicles={deleteVehicles}
                onAddVehicle={() => setIsCreateOpen(true)}
                onSelectVehicle={(vehicle) =>
                    navigate(`/vehicles/${vehicle.id}`)
                }
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
