import { useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import { DriverBoard } from "../components/drivers/DriverBoard";
import { DriverCreateForm } from "../components/drivers/DriverCreateForm";
import { DriverListBar } from "../components/drivers/DriverListBar";
import { DriverTable } from "../components/drivers/DriverTable";
import { Modal } from "../components/ui/Modal/Modal";
import { useVehicles } from "../context/vehiclesContext";
import { useAuth } from "../hooks/useAuth";
import {
    DRIVER_LIST_VIEW,
    DRIVER_VIEW_PARAM,
} from "../hooks/useDriverListQuery";

/** `/drivers` is the board; `?ansicht=liste` is the full table. */
export const DriversPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const { user } = useAuth();
    const { refetchLists } = useVehicles();
    const canWrite = user?.role === "dispatcher";
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const isList = searchParams.get(DRIVER_VIEW_PARAM) === DRIVER_LIST_VIEW;
    const openCreate = canWrite ? () => setIsCreateOpen(true) : undefined;

    return (
        <>
            {isList ? (
                <>
                    <DriverListBar />
                    <DriverTable
                        onAddDriver={openCreate}
                        onSelectDriver={(driver) => {
                            navigate(`/drivers/${driver.id}`, {
                                state: {
                                    from: `${location.pathname}${location.search}`,
                                },
                            });
                        }}
                    />
                </>
            ) : (
                <DriverBoard onAddDriver={openCreate} />
            )}

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
