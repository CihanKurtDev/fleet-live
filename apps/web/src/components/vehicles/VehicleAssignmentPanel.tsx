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
import {
    ASSIGNMENT_PICKER_PAGE_SIZE,
    useAssignmentPicker,
} from "../../hooks/useAssignmentPicker";
import { useSelectionMode } from "../../hooks/useSelectionMode";
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
import styles from "../drivers/assignment.module.scss";
import summary from "./VehicleAssignmentPanel.module.scss";

interface VehicleAssignmentPanelProps {
    vehicle: Vehicle;
    canWrite: boolean;
}

export const VehicleAssignmentPanel = ({
    vehicle,
    canWrite,
}: VehicleAssignmentPanelProps) => {
    const { listEpoch } = useVehicles();
    const vehicleOnTrip = vehicle.status === "DRIVING";
    const [rosterOpen, setRosterOpen] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
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
        (search: string, page: number, signal: AbortSignal) =>
            listDrivers(
                {
                    search,
                    page,
                    limit: ASSIGNMENT_PICKER_PAGE_SIZE,
                    dir: "asc",
                },
                signal,
            ).then((response) => ({
                data: response.data,
                page: response.meta.page,
                pageCount: response.meta.pageCount,
                total: response.meta.total,
            })),
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

            if (
                autoCurrent &&
                !vehicleOnTrip &&
                canAutoCurrentDriver(picked) &&
                ids[0] !== undefined
            ) {
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
        [vehicle.id, vehicleOnTrip],
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
        searchPending,
        page,
        pageCount,
        total,
        setPage,
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

    useEffect(() => {
        candidatesRef.current = candidates;
    });

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
                const driverOnTrip = driver.current_vehicle_status === "DRIVING";

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
                    currentLocked: vehicleOnTrip || driverOnTrip,
                    removeLocked: vehicleOnTrip && isCurrent,
                };
            });
    }, [assigned, vehicle.current_driver_id, vehicleOnTrip]);

    const rowKeys = useMemo(
        () =>
            rosterItems
                .filter((item) => !item.removeLocked)
                .map((item) => item.id),
        [rosterItems],
    );
    const selection = useSelectionMode(rowKeys, "vehicle-drivers");

    const pendingCount = pendingUnassign?.length ?? 0;
    const pendingCurrent =
        pendingUnassign?.some(
            (driver) => driver.id === vehicle.current_driver_id,
        ) ?? false;
    const eligibleOthers = assigned.filter(
        (driver) => driver.id !== vehicle.current_driver_id,
    ).length;
    const canOpenRoster = canWrite || assigned.length > 0;

    return (
        <div className={summary.summary}>
            <h3 className={summary.label}>Fahrer</h3>
            <div className={summary.line}>
                <span className={summary.current}>
                    {vehicle.current_driver_id !== null &&
                    vehicle.driver_name ? (
                        <>
                            <DriverNameLink
                                driverId={vehicle.current_driver_id}
                                name={vehicle.driver_name}
                            />
                            <span className={summary.muted}> · aktuell</span>
                        </>
                    ) : (
                        <span className={summary.muted}>
                            Kein Fahrer · Pool
                        </span>
                    )}
                </span>
                {eligibleOthers > 0 && (
                    <span className={summary.muted}>
                        +{eligibleOthers} freigegeben
                    </span>
                )}
                {canOpenRoster && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRosterOpen(true)}
                    >
                        {canWrite ? "Verwalten" : "Alle anzeigen"}
                    </Button>
                )}
            </div>
            {error && !rosterOpen && (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            )}

            <Modal
                open={rosterOpen}
                onClose={() => {
                    setRosterOpen(false);
                    selection.stop();
                }}
                title="Fahrer"
                size="lg"
            >
                <div className={summary.dialogBody}>
                    <p className={summary.sentence}>
                        Nur „Aktuell“ erscheint in der Übersicht. „Freigegeben“
                        darf fahren und steht nicht als Fahrer am Fahrzeug.
                        {vehicleOnTrip
                            ? " Fahrzeug ist unterwegs — aktueller Fahrer lässt sich erst nach der Fahrt wechseln oder entfernen."
                            : ""}
                    </p>

                    <AssignmentRoster
                        items={rosterItems}
                        canWrite={canWrite}
                        busy={busy}
                        selection={selection}
                        listLabel="Fahrer am Fahrzeug"
                        assignLabel="Zuweisen"
                        empty="Kein Fahrer. Das Fahrzeug steht im Pool."
                        error={error}
                        onAssign={openAssignPicker}
                        onRemoveSelected={(ids) =>
                            setPendingUnassign(
                                assigned.filter((driver) =>
                                    ids.includes(driver.id),
                                ),
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
                </div>
            </Modal>

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
                page={page}
                pageCount={pageCount}
                total={total}
                onPageChange={setPage}
                searchPending={searchPending}
                extraFooter={
                    canWrite ? (
                        <Button
                            variant="ghost"
                            size="md"
                            className={styles.createLink}
                            onClick={() => {
                                closeAssignPicker();
                                setCreateOpen(true);
                            }}
                        >
                            Fahrer anlegen
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
                busyLabel="Wird entfernt…"
                isBusy={busy}
                items={pendingUnassign?.map((driver) => ({
                    key: driver.id,
                    name: driver.name,
                }))}
                itemsLabel="Fahrer"
                onConfirm={() => {
                    const drivers = pendingUnassign;
                    if (!drivers || drivers.length === 0) {
                        return;
                    }

                    setPendingUnassign(null);
                    selection.stop();
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

                            if (
                                vehicle.current_driver_id === null &&
                                !vehicleOnTrip
                            ) {
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
        </div>
    );
};
