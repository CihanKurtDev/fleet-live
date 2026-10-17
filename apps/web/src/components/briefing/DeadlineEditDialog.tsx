import { useEffect, useState } from "react";
import type {
    DriverDetail,
    DueKind,
    TodayItem,
    Vehicle,
    VehicleInput,
} from "@fleet-live/shared";

import { getDriver } from "../../api/drivers";
import { getVehicle } from "../../api/vehicles";
import { useVehicles } from "../../context/vehiclesContext";
import { DriverEditForm } from "../drivers/DriverEditForm";
import type { DriverFormField } from "../drivers/driverHints";
import { RetryMessage } from "../ui/RetryMessage";
import { Modal } from "../ui/Modal/Modal";
import { VehicleForm, type VehicleFormField } from "../vehicles/VehicleForm";

const VEHICLE_FIELD: Partial<Record<DueKind, VehicleFormField>> = {
    hu: "hu",
    uvv: "uvv-checked",
};

const DRIVER_FIELD: Partial<Record<DueKind, DriverFormField>> = {
    licence_expiry: "licence-expires",
    licence_check: "licence-checked",
};

type Loaded =
    | { kind: "vehicle"; vehicle: Vehicle }
    | { kind: "driver"; driver: DriverDetail };

/**
 * "Eintragen" on a deadline row: the same edit dialog as on the vehicle or
 * driver page, opened on the field the deadline needs, right on Schicht.
 */
export const DeadlineEditDialog = ({
    item,
    onClose,
    onSaved,
}: {
    item: TodayItem | null;
    onClose: () => void;
    onSaved: () => void;
}) => {
    const { updateVehicle, refetchLists } = useVehicles();
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const vehicleId = item?.vehicle_id ?? null;
    const driverId = item?.driver_id ?? null;

    useEffect(() => {
        if (vehicleId === null && driverId === null) {
            return;
        }

        const controller = new AbortController();
        const load =
            vehicleId !== null
                ? getVehicle(vehicleId, controller.signal).then(
                      (vehicle): Loaded => ({ kind: "vehicle", vehicle }),
                  )
                : getDriver(driverId as number, controller.signal).then(
                      (driver): Loaded => ({ kind: "driver", driver }),
                  );

        load.then(setLoaded).catch((caught: unknown) => {
            if (!controller.signal.aborted) {
                setError(
                    caught instanceof Error
                        ? caught.message
                        : "Daten konnten nicht geladen werden.",
                );
            }
        });

        return () => {
            controller.abort();
            setLoaded(null);
            setError(null);
        };
    }, [vehicleId, driverId, attempt]);

    // The dialog opens before the record has loaded; focus the field the
    // deadline needs once the form is there.
    useEffect(() => {
        if (!loaded) {
            return;
        }

        const frame = requestAnimationFrame(() => {
            document
                .querySelector<HTMLElement>(
                    "dialog[open] [data-modal-body] [data-autofocus]",
                )
                ?.focus();
        });

        return () => cancelAnimationFrame(frame);
    }, [loaded]);

    const title =
        loaded?.kind === "vehicle"
            ? loaded.vehicle.license_plate
            : loaded?.kind === "driver"
              ? loaded.driver.name
              : (item?.subject ?? "");

    const saveVehicle = async (input: VehicleInput) => {
        if (loaded?.kind !== "vehicle") {
            return;
        }

        const errors = await updateVehicle(loaded.vehicle.id, input);

        if (!errors) {
            onSaved();
        }

        return errors;
    };

    return (
        <Modal open={item !== null} onClose={onClose} title={title}>
            {error && (
                <RetryMessage
                    message={error}
                    onRetry={() => setAttempt((count) => count + 1)}
                />
            )}
            {!error && !loaded && <p>Wird geladen…</p>}
            {loaded?.kind === "vehicle" && item?.due_kind && (
                <VehicleForm
                    focusField={VEHICLE_FIELD[item.due_kind]}
                    initialValue={{
                        license_plate: loaded.vehicle.license_plate,
                        fuel_level: loaded.vehicle.fuel_level,
                        status: loaded.vehicle.status,
                        vin: loaded.vehicle.vin,
                        vehicle_type: loaded.vehicle.vehicle_type,
                        hu_due_on: loaded.vehicle.hu_due_on,
                        uvv_checked_on: loaded.vehicle.uvv_checked_on,
                        uvv_due_on: loaded.vehicle.uvv_due_on,
                        home_site_id: loaded.vehicle.home_site_id,
                        cost_center: loaded.vehicle.cost_center,
                    }}
                    isFuelMeasured={loaded.vehicle.status === "DRIVING"}
                    submitLabel="Speichern"
                    onSubmit={saveVehicle}
                    onCancel={onClose}
                />
            )}
            {loaded?.kind === "driver" && item?.due_kind && (
                <DriverEditForm
                    driver={loaded.driver}
                    focusField={DRIVER_FIELD[item.due_kind]}
                    onCancel={onClose}
                    onSaved={() => {
                        refetchLists();
                        onSaved();
                    }}
                />
            )}
        </Modal>
    );
};
