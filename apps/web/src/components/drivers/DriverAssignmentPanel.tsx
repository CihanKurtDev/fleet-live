import { useEffect, useRef, useState } from "react";
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
import { AssignmentPicker } from "./AssignmentPicker";
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
    const autoCurrentRef = useRef(driver.current_vehicle === null);

    const assignedIds = new Set(driver.vehicles.map((vehicle) => vehicle.id));
    const onTrip = driver.current_vehicle?.status === "DRIVING";

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
        <section className={layout.panel}>
            <div className={layout.panelHeader}>
                <h2 className={layout.panelTitle}>Fahrzeuge</h2>
                {canWrite && (
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                            setSearch("");
                            setIsLoadingCandidates(true);
                            autoCurrentRef.current =
                                driver.current_vehicle === null;
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
            {onTrip && (
                <p className={layout.note}>
                    Fahrer ist unterwegs — aktuelles Fahrzeug lässt sich erst
                    nach der Fahrt wechseln.
                </p>
            )}
            {driver.vehicles.length === 0 ? (
                <p className={layout.empty}>Kein Fahrzeug zugewiesen.</p>
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
                                <span className={styles.pickerMeta}>
                                    {vehicleStatusLabel(vehicle.status)}
                                </span>
                                {vehicle.is_current && (
                                    <span className={styles.badge}>Aktuell</span>
                                )}
                            </div>
                            {canWrite && (
                                <div className={styles.actions}>
                                    {vehicle.is_current ? (
                                        <button
                                            type="button"
                                            className={styles.textAction}
                                            disabled={busy || onTrip}
                                            onClick={() =>
                                                void run(() =>
                                                    setDriverCurrentVehicle(
                                                        driver.id,
                                                        { vehicle_id: null },
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
                                            disabled={busy || onTrip}
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
                    ))}
                </ul>
            )}

            <AssignmentPicker
                open={assignOpen}
                title="Fahrzeuge zuweisen"
                search={search}
                searchPlaceholder="Kennzeichen suchen…"
                onSearchChange={setSearch}
                onClose={() => setAssignOpen(false)}
                items={candidates.map((vehicle) => ({
                    id: vehicle.id,
                    title: vehicle.license_plate,
                    meta: vehicleStatusLabel(vehicle.status),
                }))}
                isLoading={isLoadingCandidates}
                loadingLabel="Fahrzeuge werden geladen…"
                empty="Keine weiteren Fahrzeuge."
                busy={busy}
                onConfirm={(ids) =>
                    void run(async () => {
                        for (const id of ids) {
                            await assignDriverVehicle(driver.id, {
                                vehicle_id: id,
                            });
                        }

                        if (autoCurrentRef.current && ids[0] !== undefined && !onTrip) {
                            await setDriverCurrentVehicle(driver.id, {
                                vehicle_id: ids[0],
                            });
                            autoCurrentRef.current = false;
                        }

                        setAssignOpen(false);
                    })
                }
            />
        </section>
    );
};
