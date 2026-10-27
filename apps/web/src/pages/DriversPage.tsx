import { useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { DriverCreateForm } from "../components/drivers/DriverCreateForm";
import { DriverTable } from "../components/drivers/DriverTable";
import { PageTips } from "../components/help/PageTips";
import { Button } from "../components/ui/Button/Button";
import { Modal } from "../components/ui/Modal/Modal";
import { useVehicles } from "../context/vehiclesContext";
import { useAuth } from "../hooks/useAuth";

/** Status line handed over by the detail page after deleting a driver. */
const noticeFrom = (state: unknown): string | null => {
    if (typeof state === "object" && state !== null && "notice" in state) {
        const { notice } = state as { notice: unknown };
        return typeof notice === "string" ? notice : null;
    }

    return null;
};

/** `/drivers`: the driver list on the shared list-page frame. */
export const DriversPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useAuth();
    const { refetchLists } = useVehicles();
    const canWrite = user?.role === "dispatcher";
    const [isCreateOpen, setIsCreateOpen] = useState(false);

    return (
        <>
            <PageTips page="drivers" />
            <DriverTable
                canDelete={canWrite}
                onDeleted={refetchLists}
                initialNotice={noticeFrom(location.state)}
                actions={
                    canWrite ? (
                        <Button
                            variant="primary"
                            size="toolbar"
                            onClick={() => setIsCreateOpen(true)}
                        >
                            Fahrer anlegen
                        </Button>
                    ) : undefined
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
                                Fahrer anlegen
                            </Button>
                        </>
                    ) : undefined
                }
                onSelectDriver={(driver) => {
                    navigate(`/drivers/${driver.id}`, {
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
                title="Fahrer anlegen"
                guardUnsaved
            >
                <DriverCreateForm
                    onCancel={() => setIsCreateOpen(false)}
                    onCreated={(created) => {
                        refetchLists();
                        setIsCreateOpen(false);
                        navigate(`/drivers/${created.id}`, {
                            viewTransition: true,
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
