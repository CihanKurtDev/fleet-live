import { useEffect, useState } from "react";
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

    const assignedIds = new Set(assigned.map((driver) => driver.id));
    const current = assigned.find(
        (driver) => driver.id === vehicle.current_driver_id,
    );

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
                    <div className={styles.actions}>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                setSearch("");
                                setAssignOpen(true);
                            }}
                        >
                            Fahrer zuweisen
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setCreateOpen(true)}
                        >
                            Neuen Fahrer anlegen
                        </Button>
                    </div>
                )}
            </div>
            {error && (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            )}

            <dl className={layout.facts}>
                <div>
                    <dt>Aktueller Fahrer</dt>
                    <dd>
                        {current ? (
                            <DriverNameLink
                                driverId={current.id}
                                name={current.name}
                            />
                        ) : (
                            "—"
                        )}
                    </dd>
                </div>
            </dl>
            {canWrite && current && (
                <div className={styles.actions}>
                    <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                            void run(() =>
                                setDriverCurrentVehicle(current.id, {
                                    vehicle_id: null,
                                }),
                            )
                        }
                    >
                        Aktuellen Fahrer aufheben
                    </Button>
                </div>
            )}

            <h3 className={styles.subtitle}>Freigegebene Fahrer</h3>
            {assigned.length === 0 ? (
                <p className={layout.empty}>
                    Diesem Fahrzeug ist kein Fahrer zugewiesen. Es steht im
                    Pool.
                </p>
            ) : (
                <ul className={styles.list}>
                    {assigned.map((driver) => {
                        const isCurrent = driver.id === vehicle.current_driver_id;

                        return (
                            <li key={driver.id} className={styles.row}>
                                <div className={styles.identity}>
                                    <DriverNameLink
                                        driverId={driver.id}
                                        name={driver.name}
                                    />
                                    {isCurrent && (
                                        <span className={styles.badge}>
                                            Aktuell
                                        </span>
                                    )}
                                </div>
                                {canWrite && (
                                    <div className={styles.actions}>
                                        {!isCurrent && (
                                            <Button
                                                variant="secondary"
                                                size="sm"
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
                                                Als aktuellen Fahrer setzen
                                            </Button>
                                        )}
                                        <Button
                                            variant="ghost"
                                            size="sm"
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
                                            Freigabe entfernen
                                        </Button>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            <Modal
                open={assignOpen}
                onClose={() => setAssignOpen(false)}
                title="Fahrer zuweisen"
            >
                <div className={styles.picker}>
                    <input
                        className={styles.search}
                        type="search"
                        value={search}
                        placeholder="Fahrer suchen…"
                        onChange={(event) => setSearch(event.target.value)}
                    />
                    {isLoadingCandidates ? (
                        <p className={styles.status}>Fahrer werden geladen…</p>
                    ) : candidates.length === 0 ? (
                        <p className={layout.empty}>
                            Keine weiteren Fahrer zum Zuweisen.
                        </p>
                    ) : (
                        <ul className={styles.pickerList}>
                            {candidates.map((driver) => (
                                <li key={driver.id} className={styles.pickerItem}>
                                    <span>{driver.name}</span>
                                    <Button
                                        size="sm"
                                        disabled={busy}
                                        onClick={() =>
                                            void run(async () => {
                                                await assignDriverVehicle(
                                                    driver.id,
                                                    { vehicle_id: vehicle.id },
                                                );
                                                setAssignOpen(false);
                                            })
                                        }
                                    >
                                        Zuweisen
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </Modal>

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
                            setCreateOpen(false);
                        });
                    }}
                />
            </Modal>
        </section>
    );
};
