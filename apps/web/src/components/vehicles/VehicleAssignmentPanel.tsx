import { useEffect, useRef, useState } from "react";
import type { Driver, Vehicle } from "@fleet-live/shared";

import { ApiError, isAbortError } from "../../api/client";
import {
    assignDriverVehicle,
    listDrivers,
    setDriverCurrentVehicle,
    unassignDriverVehicle,
} from "../../api/drivers";
import { useVehicles } from "../../context/vehiclesContext";
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
    const { listEpoch, refetchLists } = useVehicles();
    const [assigned, setAssigned] = useState<Driver[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [assignOpen, setAssignOpen] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [candidates, setCandidates] = useState<Driver[]>([]);
    const [search, setSearch] = useState("");
    const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
    const autoCurrentRef = useRef(vehicle.current_driver_id === null);

    const assignedIds = new Set(assigned.map((driver) => driver.id));

    useEffect(() => {
        const controller = new AbortController();

        listDrivers(
            {
                search: "",
                page: 1,
                limit: 100,
                dir: "asc",
                vehicle_id: vehicle.id,
            },
            controller.signal,
        )
            .then((response) => {
                setAssigned(response.data);
            })
            .catch((caught: unknown) => {
                if (controller.signal.aborted || isAbortError(caught)) {
                    return;
                }

                setError(
                    caught instanceof Error
                        ? caught.message
                        : "Fahrer konnten nicht geladen werden.",
                );
            });

        return () => controller.abort();
    }, [vehicle.id, listEpoch]);

    useEffect(() => {
        if (!assignOpen) {
            return;
        }

        const controller = new AbortController();
        setIsLoadingCandidates(true);

        listDrivers(
            {
                search,
                page: 1,
                limit: 100,
                dir: "asc",
            },
            controller.signal,
        )
            .then((response) => {
                setCandidates(
                    response.data.filter((driver) => !assignedIds.has(driver.id)),
                );
            })
            .catch((caught: unknown) => {
                if (controller.signal.aborted || isAbortError(caught)) {
                    return;
                }

                setError(
                    caught instanceof Error
                        ? caught.message
                        : "Fahrer konnten nicht geladen werden.",
                );
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsLoadingCandidates(false);
                }
            });

        return () => controller.abort();
    }, [assignOpen, search, assigned]);

    const run = async (action: () => Promise<unknown>) => {
        setBusy(true);
        setError(null);

        try {
            await action();
            refetchLists();
        } catch (caught) {
            setError(
                caught instanceof ApiError
                    ? caught.message
                    : "Zuweisung konnte nicht geändert werden.",
            );
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className={layout.panel}>
            <div className={layout.panelHeader}>
                <h2 className={layout.panelTitle}>Fahrer</h2>
                {canWrite && (
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                            setSearch("");
                            setIsLoadingCandidates(true);
                            autoCurrentRef.current =
                                vehicle.current_driver_id === null;
                            setAssignOpen(true);
                        }}
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
                onClose={() => setAssignOpen(false)}
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
                                setAssignOpen(false);
                                setCreateOpen(true);
                            }}
                        >
                            Neuen Fahrer anlegen
                        </button>
                    ) : null
                }
                onConfirm={(ids) =>
                    void run(async () => {
                        for (const id of ids) {
                            await assignDriverVehicle(id, {
                                vehicle_id: vehicle.id,
                            });
                        }

                        if (autoCurrentRef.current && ids[0] !== undefined) {
                            await setDriverCurrentVehicle(ids[0], {
                                vehicle_id: vehicle.id,
                            });
                            autoCurrentRef.current = false;
                        }

                        setAssignOpen(false);
                    })
                }
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
