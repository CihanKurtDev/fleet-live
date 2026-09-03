import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import type { DriverDetail, Vehicle } from "@fleet-live/shared";

import { ApiError, isAbortError } from "../../api/client";
import {
    assignDriverVehicle,
    setDriverCurrentVehicle,
    unassignDriverVehicle,
} from "../../api/drivers";
import { listVehicles } from "../../api/vehicles";
import { useVehicles } from "../../context/vehiclesContext";
import { Button } from "../ui/Button/Button";
import { Modal } from "../ui/Modal/Modal";
import { vehicleStatusLabel } from "../vehicles/vehicleStatus";
import layout from "../../styles/detailLayout.module.scss";
import styles from "./assignment.module.scss";

interface DriverAssignmentPanelProps {
    driver: DriverDetail;
    canWrite: boolean;
}

export const DriverAssignmentPanel = ({
    driver,
    canWrite,
}: DriverAssignmentPanelProps) => {
    const location = useLocation();
    const { refetchLists } = useVehicles();
    const fromHere = `${location.pathname}${location.search}`;
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [assignOpen, setAssignOpen] = useState(false);
    const [candidates, setCandidates] = useState<Vehicle[]>([]);
    const [search, setSearch] = useState("");
    const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);

    const assignedIds = new Set(driver.vehicles.map((vehicle) => vehicle.id));
    const current = driver.current_vehicle;

    useEffect(() => {
        if (!assignOpen) {
            return;
        }

        const controller = new AbortController();
        setIsLoadingCandidates(true);

        listVehicles(
            {
                search,
                page: 1,
                limit: 100,
                dir: "asc",
                sort: "license_plate",
            },
            controller.signal,
        )
            .then((response) => {
                setCandidates(
                    response.data.filter((vehicle) => !assignedIds.has(vehicle.id)),
                );
            })
            .catch((caught: unknown) => {
                if (controller.signal.aborted || isAbortError(caught)) {
                    return;
                }

                setError(
                    caught instanceof Error
                        ? caught.message
                        : "Fahrzeuge konnten nicht geladen werden.",
                );
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsLoadingCandidates(false);
                }
            });

        return () => controller.abort();
    }, [assignOpen, search, driver.vehicles]);

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
        <>
            <section className={layout.panel}>
                <div className={layout.panelHeader}>
                    <h2 className={layout.panelTitle}>Aktuelles Fahrzeug</h2>
                    {canWrite && current && (
                        <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                                void run(() =>
                                    setDriverCurrentVehicle(driver.id, {
                                        vehicle_id: null,
                                    }),
                                )
                            }
                        >
                            Aktuelles Fahrzeug aufheben
                        </Button>
                    )}
                </div>
                {error && (
                    <p className={styles.error} role="alert">
                        {error}
                    </p>
                )}
                {current ? (
                    <p className={styles.identity}>
                        <Link
                            className={styles.link}
                            to={`/vehicles/${current.id}`}
                            state={{ from: fromHere }}
                        >
                            {current.license_plate}
                        </Link>
                        <span className={styles.status}>
                            {vehicleStatusLabel(current.status)}
                        </span>
                    </p>
                ) : (
                    <p className={layout.empty}>
                        Kein aktuelles Fahrzeug. Freigegebene Fahrzeuge bleiben
                        im Pool.
                    </p>
                )}
            </section>

            <section className={layout.panel}>
                <div className={layout.panelHeader}>
                    <h2 className={layout.panelTitle}>Freigegebene Fahrzeuge</h2>
                    {canWrite && (
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                setSearch("");
                                setAssignOpen(true);
                            }}
                        >
                            Fahrzeug zuweisen
                        </Button>
                    )}
                </div>
                {driver.vehicles.length === 0 ? (
                    <p className={layout.empty}>
                        Diesem Fahrer ist kein Fahrzeug zugewiesen.
                    </p>
                ) : (
                    <ul className={styles.list}>
                        {driver.vehicles.map((vehicle) => (
                            <li key={vehicle.id} className={styles.row}>
                                <div className={styles.identity}>
                                    <Link
                                        className={styles.link}
                                        to={`/vehicles/${vehicle.id}`}
                                        state={{ from: fromHere }}
                                    >
                                        {vehicle.license_plate}
                                    </Link>
                                    <span className={styles.status}>
                                        {vehicleStatusLabel(vehicle.status)}
                                    </span>
                                    {vehicle.is_current && (
                                        <span className={styles.badge}>
                                            Aktuell
                                        </span>
                                    )}
                                </div>
                                {canWrite && (
                                    <div className={styles.actions}>
                                        {!vehicle.is_current && (
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
                                                Als aktuelles Fahrzeug setzen
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
                        ))}
                    </ul>
                )}
            </section>

            <Modal
                open={assignOpen}
                onClose={() => setAssignOpen(false)}
                title="Fahrzeug zuweisen"
            >
                <div className={styles.picker}>
                    <input
                        className={styles.search}
                        type="search"
                        value={search}
                        placeholder="Kennzeichen suchen…"
                        onChange={(event) => setSearch(event.target.value)}
                    />
                    {isLoadingCandidates ? (
                        <p className={styles.status}>Fahrzeuge werden geladen…</p>
                    ) : candidates.length === 0 ? (
                        <p className={layout.empty}>
                            Keine weiteren Fahrzeuge zum Zuweisen.
                        </p>
                    ) : (
                        <ul className={styles.pickerList}>
                            {candidates.map((vehicle) => (
                                <li key={vehicle.id} className={styles.pickerItem}>
                                    <span>
                                        {vehicle.license_plate}
                                        <span className={styles.status}>
                                            {" "}
                                            · {vehicleStatusLabel(vehicle.status)}
                                        </span>
                                    </span>
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
        </>
    );
};
