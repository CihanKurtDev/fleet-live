import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import type {
    TelemetryPatch,
    Vehicle,
    VehicleFieldErrors,
    VehicleInput,
} from "@fleet-live/shared";
import { ApiError } from "../api/client";
import {
    createVehicle as createVehicleRequest,
    deleteVehicle as deleteVehicleRequest,
    updateVehicle as updateVehicleRequest,
} from "../api/vehicles";
import { forgetVehicles, rememberVehicle } from "../api/vehicleCache";
import { invalidateVehicleListCache } from "../api/vehicleListCache";
import {
    VehiclesContext,
    type TripPathDeltaHandler,
} from "./vehiclesContext";
import { useVehicleStream } from "../hooks/useVehicleStream";

const fieldErrorsFromApi = (
    error: unknown,
): VehicleFieldErrors | void => {
    if (!(error instanceof ApiError)) {
        throw error;
    }

    if (error.status === 409) {
        return (
            error.fields ?? {
                license_plate: "Kennzeichen ist bereits vergeben.",
            }
        );
    }

    if (error.status === 400 && error.fields) {
        return error.fields;
    }

    throw error;
};

export const VehiclesProvider = ({
    children,
}: {
    children: ReactNode;
}) => {
    const [listEpoch, setListEpoch] = useState(0);
    const [vehicleOverrides, setVehicleOverrides] = useState<
        Record<number, Partial<Vehicle>>
    >({});
    const pathDeltaListeners = useRef(new Set<TripPathDeltaHandler>());

    const subscribeTripPath = useCallback(
        (handler: TripPathDeltaHandler) => {
            pathDeltaListeners.current.add(handler);
            return () => {
                pathDeltaListeners.current.delete(handler);
            };
        },
        [],
    );

    const refetchLists = useCallback(() => {
        invalidateVehicleListCache();
        setListEpoch((current) => current + 1);
    }, []);

    const applyTelemetry = useCallback((patches: TelemetryPatch[]) => {
        if (patches.length === 0) {
            return;
        }

        setVehicleOverrides((current) => {
            const next = { ...current };

            for (const patch of patches) {
                next[patch.id] = {
                    ...next[patch.id],
                    speed: patch.speed,
                    latitude: patch.latitude,
                    longitude: patch.longitude,
                    recorded_at: patch.recorded_at,
                    fuel_level: patch.fuel_level,
                    ...(patch.speeding_open !== undefined
                        ? { speeding_open: patch.speeding_open }
                        : {}),
                };
            }

            const keys = Object.keys(next);
            const maxOverrides = 300;

            if (keys.length > maxOverrides) {
                const overflow = keys.length - maxOverrides;
                for (let index = 0; index < overflow; index += 1) {
                    delete next[Number(keys[index])];
                }
            }

            return next;
        });

        for (const patch of patches) {
            if (patch.path_delta) {
                const reset = patch.path_reset === true;
                for (const listener of pathDeltaListeners.current) {
                    listener(patch.id, patch.path_delta, reset);
                }
            }
        }
    }, []);

    useVehicleStream({
        onTelemetry: applyTelemetry,
        onVehiclesChanged: refetchLists,
    });

    const createVehicle = useCallback(
        async (
            input: VehicleInput,
        ): Promise<VehicleFieldErrors | void> => {
            try {
                const created = await createVehicleRequest(input);
                rememberVehicle(created);
                refetchLists();
            } catch (error) {
                return fieldErrorsFromApi(error);
            }
        },
        [refetchLists],
    );

    const updateVehicle = useCallback(
        async (
            id: number,
            input: VehicleInput,
        ): Promise<VehicleFieldErrors | void> => {
            try {
                const updated = await updateVehicleRequest(id, input);
                rememberVehicle(updated);
                refetchLists();
                setVehicleOverrides((current) => {
                    const next = { ...current };
                    delete next[id];
                    return next;
                });
            } catch (error) {
                return fieldErrorsFromApi(error);
            }
        },
        [refetchLists],
    );

    const deleteVehicles = useCallback(
        async (ids: number[]) => {
            await Promise.all(ids.map((id) => deleteVehicleRequest(id)));
            forgetVehicles(ids);
            refetchLists();
        },
        [refetchLists],
    );

    const value = useMemo(
        () => ({
            listEpoch,
            vehicleOverrides,
            refetchLists,
            createVehicle,
            updateVehicle,
            deleteVehicles,
            subscribeTripPath,
        }),
        [
            listEpoch,
            vehicleOverrides,
            refetchLists,
            createVehicle,
            updateVehicle,
            deleteVehicles,
            subscribeTripPath,
        ],
    );

    return (
        <VehiclesContext.Provider value={value}>
            {children}
        </VehiclesContext.Provider>
    );
};
