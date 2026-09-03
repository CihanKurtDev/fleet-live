import { useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { DriverCreateForm } from "../components/drivers/DriverCreateForm";
import { DriverTable } from "../components/drivers/DriverTable";
import { Modal } from "../components/ui/Modal/Modal";
import { useVehicles } from "../context/vehiclesContext";
import { useAuth } from "../hooks/useAuth";

export const DriversPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useAuth();
    const { refetchLists } = useVehicles();
    const canWrite = user?.role === "dispatcher";
    const [isCreateOpen, setIsCreateOpen] = useState(false);

    return (
        <>
            <DriverTable
                onAddDriver={canWrite ? () => setIsCreateOpen(true) : undefined}
                onSelectDriver={(driver) => {
                    navigate(`/drivers/${driver.id}`, {
                        state: {
                            from: `${location.pathname}${location.search}`,
                        },
                    });
                }}
            />

            <Modal
                open={isCreateOpen}
                onClose={() => setIsCreateOpen(false)}
                title="Fahrer anlegen"
            >
                <DriverCreateForm
                    onCancel={() => setIsCreateOpen(false)}
                    onCreated={(created) => {
                        refetchLists();
                        setIsCreateOpen(false);
                        navigate(`/drivers/${created.id}`, {
                            state: {
                                from: `${location.pathname}${location.search}`,
                            },
                        });
                    }}
                />
            </Modal>
        </>
    );
};
