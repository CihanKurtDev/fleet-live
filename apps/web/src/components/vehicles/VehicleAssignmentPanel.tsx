import { useCallback, useMemo, useState } from "react";
import type { Driver, Vehicle } from "@fleet-live/shared";

import {
    assignDriverVehicle,
    listDrivers,
    setDriverCurrentVehicle,
    unassignDriverVehicle,
} from "../../api/drivers";
import { useVehicles } from "../../context/vehiclesContext";
import { useAssignmentPicker } from "../../hooks/useAssignmentPicker";
import { Button } from "../ui/Button/Button";
import { Modal } from "../ui/Modal/Modal";
import { AssignmentPicker } from "../drivers/AssignmentPicker";
import { DriverCreateForm } from "../drivers/DriverCreateForm";
import { DriverNameLink } from "../drivers/DriverNameLink";
import layout from "../../styles/detailLayout.module.scss";
import styles from "../drivers/assignment.module.scss";

interface VehicleAssignmentPanelProps {
    vehicle: Vehicle;
    canWrite: boolean;
}

export const VehicleAssignmentPanel = ({
    vehicle,
    canWrite,
}: VehicleAssignmentPanelProps) => {
    const { listEpoch } = useVehicles();
    const [createOpen, setCreateOpen] = useState(false);

    const fetchAssigned = useCallback(
        (signal: AbortSignal) =>
            listDrivers(
                {
                    search: "",
                    page: 1,
                    limit: 100,
                    dir: "asc",
                    vehicle_id: vehicle.id,
                },
                signal,
            ).then((response) => response.data),
        [vehicle.id],
    );

    const fetchCandidates = useCallback(
        (search: string, signal: AbortSignal) =>
            listDrivers(
                {
                    search,
                    page: 1,
                    limit: 100,
                    dir: "asc",
                },
                signal,
            ).then((response) => response.data),
        [],
    );

    const getAutoCurrentOnOpen = useCallback(
        () => vehicle.current_driver_id === null,
        [vehicle.current_driver_id],
    );

    const onConfirmAssign = useCallback(
        async (
            ids: number[],
            { autoCurrent, clearAutoCurrent, closePicker }: {
                autoCurrent: boolean;
                clearAutoCurrent: () => void;
                closePicker: () => void;
            },
        ) => {
            for (const id of ids) {
                await assignDriverVehicle(id, {
                    vehicle_id: vehicle.id,
                });
            }

            if (autoCurrent && ids[0] !== undefined) {
                await setDriverCurrentVehicle(ids[0], {
                    vehicle_id: vehicle.id,
                });
                clearAutoCurrent();
            }

            closePicker();
        },
        [vehicle.id],
    );

    const assignedConfig = useMemo(
        () => ({
            deps: [vehicle.id, listEpoch] as const,
            fetch: fetchAssigned,
            errorMessage: "Fahrer konnten nicht geladen werden.",
        }),
        [fetchAssigned, listEpoch, vehicle.id],
    );

    const {
        error,
        busy,
        run,
        assignOpen,
        openAssignPicker,
        closeAssignPicker,
        search,
        setSearch,
        candidates,
        isLoadingCandidates,
        confirmAssign,
        assigned,
    } = useAssignmentPicker<Driver, Driver>({
        mode: "entity",
        fetchCandidates,
        candidatesLoadError: "Fahrer konnten nicht geladen werden.",
        mutationError: "Zuweisung konnte nicht geändert werden.",
        getAutoCurrentOnOpen,
        onConfirmAssign,
        assigned: assignedConfig,
    });

    return (
        <section className={layout.panel}>
            <div className={layout.panelHeader}>
                <h2 className={layout.panelTitle}>Fahrer</h2>
                {canWrite && (
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={openAssignPicker}
                    >
                        Zuweisen
                    </Button>
                )}
            </div>
            {error && (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            )}
            <p className={layout.note}>
                Freigegebene Fahrer dürfen das Fahrzeug nutzen. In der
                Übersicht erscheint nur der Fahrer mit „Aktuell“.
            </p>

            {assigned.length === 0 ? (
                <p className={layout.empty}>
                    Kein Fahrer. Das Fahrzeug steht im Pool.
                </p>
            ) : (
                <ul className={styles.list}>
                    {assigned.map((driver) => {
                        const isCurrent =
                            driver.id === vehicle.current_driver_id;

                        return (
                            <li key={driver.id} className={styles.row}>
                                <div className={styles.identity}>
                                    <DriverNameLink
                                        driverId={driver.id}
                                        name={driver.name}
                                    />
                                    {isCurrent ? (
                                        <span className={styles.badge}>
                                            Aktuell
                                        </span>
                                    ) : (
                                        <span className={styles.badgeMuted}>
                                            Freigegeben
                                        </span>
                                    )}
                                </div>
                                {canWrite && (
                                    <div className={styles.actions}>
                                        {isCurrent ? (
                                            <button
                                                type="button"
                                                className={styles.textAction}
                                                disabled={busy}
                                                onClick={() =>
                                                    void run(() =>
                                                        setDriverCurrentVehicle(
                                                            driver.id,
                                                            {
                                                                vehicle_id:
                                                                    null,
                                                            },
                                                        ),
                                                    )
                                                }
                                            >
                                                Aufheben
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                className={styles.textAction}
                                                disabled={busy}
                                                onClick={() =>
                                                    void run(() =>
                                                        setDriverCurrentVehicle(
                                                            driver.id,
                                                            {
                                                                vehicle_id:
                                                                    vehicle.id,
                                                            },
                                                        ),
                                                    )
                                                }
                                            >
                                                Als aktuell
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            className={styles.textAction}
                                            disabled={busy}
                                            onClick={() =>
                                                void run(() =>
                                                    unassignDriverVehicle(
                                                        driver.id,
                                                        vehicle.id,
                                                    ),
                                                )
                                            }
                                        >
                                            Entfernen
                                        </button>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            <AssignmentPicker
                open={assignOpen}
                title="Fahrer zuweisen"
                search={search}
                searchPlaceholder="Fahrer suchen…"
                onSearchChange={setSearch}
                onClose={closeAssignPicker}
                items={candidates.map((driver) => ({
                    id: driver.id,
                    title: driver.name,
                }))}
                isLoading={isLoadingCandidates}
                loadingLabel="Fahrer werden geladen…"
                empty="Keine weiteren Fahrer."
                busy={busy}
                extraFooter={
                    canWrite ? (
                        <button
                            type="button"
                            className={styles.footerLink}
                            onClick={() => {
                                closeAssignPicker();
                                setCreateOpen(true);
                            }}
                        >
                            Neuen Fahrer anlegen
                        </button>
                    ) : null
                }
                onConfirm={confirmAssign}
            />

            <Modal
                open={createOpen}
                onClose={() => setCreateOpen(false)}
                title="Neuen Fahrer anlegen"
            >
                <DriverCreateForm
                    onCancel={() => setCreateOpen(false)}
                    onCreated={(created) => {
                        void run(async () => {
                            await assignDriverVehicle(created.id, {
                                vehicle_id: vehicle.id,
                            });

                            if (vehicle.current_driver_id === null) {
                                await setDriverCurrentVehicle(created.id, {
                                    vehicle_id: vehicle.id,
                                });
                            }

                            setCreateOpen(false);
                        });
                    }}
                />
            </Modal>
        </section>
    );
};
