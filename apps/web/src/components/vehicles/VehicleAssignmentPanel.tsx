import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Driver, Vehicle } from "@fleet-live/shared";

import {
    assignDriverVehicle,
    listDrivers,
    setDriverCurrentVehicle,
    unassignDriverVehicle,
} from "../../api/drivers";
import { ApiError } from "../../api/client";
import { useVehicles } from "../../context/vehiclesContext";
import { useAssignmentPicker } from "../../hooks/useAssignmentPicker";
import { Button } from "../ui/Button/Button";
import { ConfirmDialog } from "../ui/Modal/ConfirmDialog";
import { Modal } from "../ui/Modal/Modal";
import { AssignmentPicker } from "../drivers/AssignmentPicker";
import { AssignmentRoster } from "../drivers/AssignmentRoster";
import {
    assignmentStatus,
    canAutoCurrentDriver,
    driverPickerStatus,
} from "../drivers/assignmentMeta";
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
    const [editing, setEditing] = useState(false);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [pendingUnassign, setPendingUnassign] = useState<Driver[] | null>(
        null,
    );
    const candidatesRef = useRef<Driver[]>([]);

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

            const picked =
                ids.length === 1
                    ? candidatesRef.current.find(
                          (driver) => driver.id === ids[0],
                      )
                    : undefined;

            if (autoCurrent && canAutoCurrentDriver(picked) && ids[0] !== undefined) {
                try {
                    await setDriverCurrentVehicle(ids[0], {
                        vehicle_id: vehicle.id,
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

    candidatesRef.current = candidates;

    useEffect(() => {
        const allowed = new Set(assigned.map((driver) => driver.id));
        setSelectedIds((current) =>
            current.filter((id) => allowed.has(id)),
        );
        if (assigned.length === 0) {
            setEditing(false);
        }
    }, [assigned]);

    const rosterItems = useMemo(() => {
        return [...assigned]
            .sort((left, right) => {
                const leftCurrent =
                    left.id === vehicle.current_driver_id ? 0 : 1;
                const rightCurrent =
                    right.id === vehicle.current_driver_id ? 0 : 1;

                if (leftCurrent !== rightCurrent) {
                    return leftCurrent - rightCurrent;
                }

                return left.name.localeCompare(right.name, "de");
            })
            .map((driver) => {
                const isCurrent = driver.id === vehicle.current_driver_id;
                const onTrip = driver.current_vehicle_status === "DRIVING";

                return {
                    id: driver.id,
                    title: (
                        <DriverNameLink
                            driverId={driver.id}
                            name={driver.name}
                        />
                    ),
                    avatarName: driver.name,
                    selectLabel: `${driver.name} auswählen`,
                    status: assignmentStatus(
                        isCurrent ? "Aktuell" : "Freigegeben",
                        driver.current_vehicle_status,
                        driver.current_vehicle_plate,
                    ),
                    isCurrent,
                    currentLocked: onTrip,
                };
            });
    }, [assigned, vehicle.current_driver_id]);

    const pendingCount = pendingUnassign?.length ?? 0;
    const pendingCurrent =
        pendingUnassign?.some(
            (driver) => driver.id === vehicle.current_driver_id,
        ) ?? false;
    const selectedCount = selectedIds.length;

    return (
        <section className={layout.panel}>
            <div className={layout.panelHeader}>
                <div className={styles.headerCopy}>
                    <h2 className={layout.panelTitle}>Fahrer</h2>
                    {assigned.length > 0 && (
                        <p className={layout.note}>
                            Nur „Aktuell“ erscheint in der Übersicht.
                        </p>
                    )}
                </div>
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
                                            assigned.filter((driver) =>
                                                selectedIds.includes(driver.id),
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
                        {assigned.length > 0 && (
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
                            + Zuweisen
                        </Button>
                    </div>
                )}
            </div>
            {error && (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            )}

            <AssignmentRoster
                items={rosterItems}
                editing={editing}
                busy={busy}
                selectedIds={selectedIds}
                empty="Kein Fahrer. Das Fahrzeug steht im Pool."
                onToggle={(id) =>
                    setSelectedIds((current) =>
                        current.includes(id)
                            ? current.filter((selected) => selected !== id)
                            : [...current, id],
                    )
                }
                onSetCurrent={(id) =>
                    void run(() =>
                        setDriverCurrentVehicle(id, {
                            vehicle_id: vehicle.id,
                        }),
                    )
                }
                onClearCurrent={(id) =>
                    void run(() =>
                        setDriverCurrentVehicle(id, {
                            vehicle_id: null,
                        }),
                    )
                }
                onRemove={(id) => {
                    const driver = assigned.find((row) => row.id === id);
                    if (driver) {
                        setPendingUnassign([driver]);
                    }
                }}
            />

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
                    status: driverPickerStatus(driver),
                }))}
                isLoading={isLoadingCandidates}
                loadingLabel="Fahrer werden geladen…"
                empty="Keine weiteren Fahrer."
                busy={busy}
                extraFooter={
                    canWrite ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            className={styles.createLink}
                            onClick={() => {
                                closeAssignPicker();
                                setCreateOpen(true);
                            }}
                        >
                            Neuen Fahrer anlegen
                        </Button>
                    ) : null
                }
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
                    const drivers = pendingUnassign;
                    if (!drivers || drivers.length === 0) {
                        return;
                    }

                    setPendingUnassign(null);
                    setSelectedIds([]);
                    void run(async () => {
                        for (const driver of drivers) {
                            await unassignDriverVehicle(driver.id, vehicle.id);
                        }
                    });
                }}
            >
                {pendingCount === 1 ? (
                    <p>
                        „{pendingUnassign?.[0]?.name}“ wirklich von diesem
                        Fahrzeug entfernen?
                    </p>
                ) : (
                    <p>
                        Diese {pendingCount} Fahrer wirklich von diesem
                        Fahrzeug entfernen?
                        {pendingCurrent
                            ? " Der aktuelle Fahrer wird mit entfernt."
                            : ""}
                    </p>
                )}
            </ConfirmDialog>

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
                                try {
                                    await setDriverCurrentVehicle(created.id, {
                                        vehicle_id: vehicle.id,
                                    });
                                } catch (caught) {
                                    if (
                                        !(
                                            caught instanceof ApiError &&
                                            caught.status === 409
                                        )
                                    ) {
                                        throw caught;
                                    }
                                }
                            }

                            setCreateOpen(false);
                        });
                    }}
                />
            </Modal>
        </section>
    );
};
