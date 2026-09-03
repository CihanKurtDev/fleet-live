import { useCallback } from "react";
import { Link, useLocation } from "react-router";
import type { DriverDetail, Vehicle } from "@fleet-live/shared";

import {
    assignDriverVehicle,
    setDriverCurrentVehicle,
    unassignDriverVehicle,
} from "../../api/drivers";
import { listVehicles } from "../../api/vehicles";
import { useAssignmentPicker } from "../../hooks/useAssignmentPicker";
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
    const fromHere = `${location.pathname}${location.search}`;
    const assignedIds = new Set(driver.vehicles.map((vehicle) => vehicle.id));
    const onTrip = driver.current_vehicle?.status === "DRIVING";

    const fetchCandidates = useCallback(
        (search: string, signal: AbortSignal) =>
            listVehicles(
                {
                    search,
                    page: 1,
                    limit: 100,
                    dir: "asc",
                    sort: "license_plate",
                },
                signal,
            ).then((response) => response.data),
        [],
    );

    const getAutoCurrentOnOpen = useCallback(
        () => driver.current_vehicle === null,
        [driver.current_vehicle],
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
                await assignDriverVehicle(driver.id, {
                    vehicle_id: id,
                });
            }

            if (autoCurrent && ids[0] !== undefined && !onTrip) {
                await setDriverCurrentVehicle(driver.id, {
                    vehicle_id: ids[0],
                });
                clearAutoCurrent();
            }

            closePicker();
        },
        [driver.id, onTrip],
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
    } = useAssignmentPicker<Vehicle>({
        mode: "entity",
        excludedIds: assignedIds,
        fetchCandidates,
        candidatesLoadError: "Fahrzeuge konnten nicht geladen werden.",
        mutationError: "Zuweisung konnte nicht geändert werden.",
        getAutoCurrentOnOpen,
        onConfirmAssign,
    });

    return (
        <section className={layout.panel}>
            <div className={layout.panelHeader}>
                <h2 className={layout.panelTitle}>Fahrzeuge</h2>
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
                onClose={closeAssignPicker}
                items={candidates.map((vehicle) => ({
                    id: vehicle.id,
                    title: vehicle.license_plate,
                    meta: vehicleStatusLabel(vehicle.status),
                }))}
                isLoading={isLoadingCandidates}
                loadingLabel="Fahrzeuge werden geladen…"
                empty="Keine weiteren Fahrzeuge."
                busy={busy}
                onConfirm={confirmAssign}
            />
        </section>
    );
};
