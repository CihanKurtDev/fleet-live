import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { VehicleInput } from "@fleet-live/shared";

import { PageTips } from "../components/help/PageTips";
import { VehicleTable } from "../components/vehicles/VehicleTable";
import { ExportMenu } from "../components/export/ExportMenu";
import { VehicleForm } from "../components/vehicles/VehicleForm";
import { Button } from "../components/ui/Button/Button";
import { Modal } from "../components/ui/Modal/Modal";
import { useVehicles } from "../context/vehiclesContext";
import { useAuth } from "../hooks/useAuth";
import { useStatusNotice } from "../hooks/useStatusNotice";
import { getMe } from "../api/auth";
import { rememberVehicle } from "../api/vehicleCache";
import { setTelemetryFocus } from "../api/telemetryFocus";

export const VehiclesPage = () => {
    const { createVehicle, deleteVehicles } = useVehicles();
    const { user, setUser } = useAuth();
    const canWrite = user?.role === "dispatcher";
    const navigate = useNavigate();
    const location = useLocation();

    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const { notice, show: showNotice } = useStatusNotice();

    const handleCreate = async (input: VehicleInput) => {
        const errors = await createVehicle(input);

        if (errors) {
            return errors;
        }

        setIsCreateOpen(false);
        showNotice(`Fahrzeug ${input.license_plate.trim()} angelegt.`);

        // The first vehicle ends the import question on Schicht.
        if (user?.import_prompt) {
            void getMe()
                .then(setUser)
                .catch(() => undefined);
        }
    };

    return (
        <>
            <PageTips page="vehicles" />
            <VehicleTable
                pageNotice={notice}
                onDeleteVehicles={canWrite ? deleteVehicles : undefined}
                actions={
                    canWrite
                        ? (empty) => (
                              <>
                                  <Button
                                      variant="secondary"
                                      size="toolbar"
                                      onClick={() => navigate("/vehicles/import")}
                                  >
                                      Importieren
                                  </Button>
                                  <ExportMenu
                                      kinds={["vehicles", "trips"]}
                                      disabled={empty}
                                  />
                                  <Button
                                      variant="primary"
                                      size="toolbar"
                                      onClick={() => setIsCreateOpen(true)}
                                  >
                                      Fahrzeug anlegen
                                  </Button>
                              </>
                          )
                        : undefined
                }
                emptyActions={
                    canWrite ? (
                        <>
                            <Button
                                variant="primary"
                                size="toolbar"
                                onClick={() => navigate("/vehicles/import")}
                            >
                                Bestand importieren
                            </Button>
                            <Button
                                variant="secondary"
                                size="toolbar"
                                onClick={() => setIsCreateOpen(true)}
                            >
                                Fahrzeug anlegen
                            </Button>
                        </>
                    ) : undefined
                }
                onSelectVehicle={(vehicle) => {
                    rememberVehicle(vehicle);
                    setTelemetryFocus("detail", [vehicle.id]);
                    navigate(`/vehicles/${vehicle.id}`, {
                        viewTransition: true,
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
                guardUnsaved
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
