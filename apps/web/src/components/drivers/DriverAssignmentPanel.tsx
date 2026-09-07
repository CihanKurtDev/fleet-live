import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import type { DriverDetail, DriverVehicle, Vehicle } from "@fleet-live/shared";

import {
    assignDriverVehicle,
    setDriverCurrentVehicle,
    unassignDriverVehicle,
} from "../../api/drivers";
import { ApiError } from "../../api/client";
import { listVehicles } from "../../api/vehicles";
import { useAssignmentPicker } from "../../hooks/useAssignmentPicker";
import { Button } from "../ui/Button/Button";
import { ConfirmDialog } from "../ui/Modal/ConfirmDialog";
import { AssignmentPicker } from "./AssignmentPicker";
import { AssignmentRoster } from "./AssignmentRoster";
import {
    assignmentStatus,
    canAutoCurrentVehicle,
} from "./assignmentMeta";
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
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [editing, setEditing] = useState(false);
    const [pendingUnassign, setPendingUnassign] = useState<
        DriverVehicle[] | null
    >(null);
    const candidatesRef = useRef<Vehicle[]>([]);

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

            const picked =
                ids.length === 1
                    ? candidatesRef.current.find(
                          (vehicle) => vehicle.id === ids[0],
                      )
                    : undefined;

            if (
                autoCurrent &&
                !onTrip &&
                canAutoCurrentVehicle(picked) &&
                ids[0] !== undefined
            ) {
                try {
                    await setDriverCurrentVehicle(driver.id, {
                        vehicle_id: ids[0],
                    });
                    clearAutoCurrent();
                } catch (caught) {
                    if (
                        !(caught instanceof ApiError && caught.status === 409)
                    ) {
                        throw caught;
                    }
                }
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

    candidatesRef.current = candidates;

    useEffect(() => {
        const allowed = new Set(driver.vehicles.map((vehicle) => vehicle.id));
        setSelectedIds((current) =>
            current.filter((id) => allowed.has(id)),
        );
        if (driver.vehicles.length === 0) {
            setEditing(false);
        }
    }, [driver.vehicles]);

    const rosterItems = useMemo(() => {
        return [...driver.vehicles]
            .sort((left, right) => {
                if (left.is_current !== right.is_current) {
                    return left.is_current ? -1 : 1;
                }

                return left.license_plate.localeCompare(
                    right.license_plate,
                    "de",
                );
            })
            .map((vehicle) => ({
                id: vehicle.id,
                title: (
                    <Link
                        to={`/vehicles/${vehicle.id}`}
                        state={{ from: fromHere }}
                    >
                        {vehicle.license_plate}
                    </Link>
                ),
                avatarName: vehicle.license_plate,
                selectLabel: `${vehicle.license_plate} auswählen`,
                status: assignmentStatus(
                    vehicle.is_current ? "Aktuell" : "Zugewiesen",
                    vehicle.status,
                ),
                isCurrent: vehicle.is_current,
                currentLocked: onTrip,
            }));
    }, [driver.vehicles, fromHere, onTrip]);

    const pendingCount = pendingUnassign?.length ?? 0;
    const pendingCurrent =
        pendingUnassign?.some((vehicle) => vehicle.is_current) ?? false;
    const selectedCount = selectedIds.length;

    return (
        <section className={layout.panel}>
            <div className={layout.panelHeader}>
                <h2 className={layout.panelTitle}>Fahrzeuge</h2>
                {canWrite && (
                    <div className={styles.headerActions}>
                        {editing && selectedCount > 0 && (
                            <>
                                <span className={styles.selectionCount}>
                                    {selectedCount === 1
                                        ? "1 ausgewählt"
                                        : `${selectedCount} ausgewählt`}
                                </span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={busy}
                                    onClick={() => setSelectedIds([])}
                                >
                                    Auswahl aufheben
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={busy}
                                    onClick={() =>
                                        setPendingUnassign(
                                            driver.vehicles.filter((vehicle) =>
                                                selectedIds.includes(
                                                    vehicle.id,
                                                ),
                                            ),
                                        )
                                    }
                                >
                                    {selectedCount === 1
                                        ? "1 entfernen"
                                        : `${selectedCount} entfernen`}
                                </Button>
                            </>
                        )}
                        {driver.vehicles.length > 0 && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    setEditing((current) => !current);
                                    setSelectedIds([]);
                                }}
                            >
                                {editing ? "Fertig" : "Bearbeiten"}
                            </Button>
                        )}
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={openAssignPicker}
                        >
                            Zuweisen
                        </Button>
                    </div>
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

            <AssignmentRoster
                items={rosterItems}
                editing={editing}
                busy={busy}
                selectedIds={selectedIds}
                empty="Kein Fahrzeug zugewiesen."
                onToggle={(id) =>
                    setSelectedIds((current) =>
                        current.includes(id)
                            ? current.filter((selected) => selected !== id)
                            : [...current, id],
                    )
                }
                onSetCurrent={(id) =>
                    void run(() =>
                        setDriverCurrentVehicle(driver.id, {
                            vehicle_id: id,
                        }),
                    )
                }
                onClearCurrent={() =>
                    void run(() =>
                        setDriverCurrentVehicle(driver.id, {
                            vehicle_id: null,
                        }),
                    )
                }
                onRemove={(id) => {
                    const vehicle = driver.vehicles.find(
                        (row) => row.id === id,
                    );
                    if (vehicle) {
                        setPendingUnassign([vehicle]);
                    }
                }}
            />

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
                    status: assignmentStatus(
                        vehicle.driver_name ?? "Pool",
                        vehicle.status,
                    ),
                }))}
                isLoading={isLoadingCandidates}
                loadingLabel="Fahrzeuge werden geladen…"
                empty="Keine weiteren Fahrzeuge."
                busy={busy}
                onConfirm={confirmAssign}
            />

            <ConfirmDialog
                open={pendingUnassign !== null}
                onClose={() => setPendingUnassign(null)}
                title={
                    pendingCount === 1
                        ? "Zuweisung entfernen?"
                        : `${pendingCount} Zuweisungen entfernen?`
                }
                confirmLabel="Entfernen"
                onConfirm={() => {
                    const vehicles = pendingUnassign;
                    if (!vehicles || vehicles.length === 0) {
                        return;
                    }

                    setPendingUnassign(null);
                    setSelectedIds([]);
                    void run(async () => {
                        for (const vehicle of vehicles) {
                            await unassignDriverVehicle(driver.id, vehicle.id);
                        }
                    });
                }}
            >
                {pendingCount === 1 ? (
                    <p>
                        „{pendingUnassign?.[0]?.license_plate}“ wirklich von
                        diesem Fahrer entfernen?
                    </p>
                ) : (
                    <p>
                        Diese {pendingCount} Fahrzeuge wirklich von diesem
                        Fahrer entfernen?
                        {pendingCurrent
                            ? " Das aktuelle Fahrzeug wird mit entfernt."
                            : ""}
                    </p>
                )}
            </ConfirmDialog>
        </section>
    );
};
