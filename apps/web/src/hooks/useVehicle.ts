import { useEffect, useState } from "react";
import type { Vehicle } from "@fleet-live/shared";
import { ApiError, isAbortError } from "../api/client";
import { retryTransient } from "../api/retryTransient";
import { peekVehicle, rememberVehicle } from "../api/vehicleCache";
import {
    clearTelemetryFocus,
    setTelemetryFocus,
} from "../api/telemetryFocus";
import { getVehicle } from "../api/vehicles";
import { useVehicles } from "../context/vehiclesContext";

export const useVehicle = (id: number | null) => {
    const { listEpoch, vehicleOverrides } = useVehicles();
    const cached = id !== null ? peekVehicle(id) : undefined;

    const [vehicle, setVehicle] = useState<Vehicle | undefined>(cached);
    const [isLoading, setIsLoading] = useState(id !== null && !cached);
    const [error, setError] = useState<string | null>(null);
    const [notFound, setNotFound] = useState(false);

    useEffect(() => {
        if (id === null) {
            setVehicle(undefined);
            setIsLoading(false);
            setNotFound(true);
            return;
        }

        const existing = peekVehicle(id);
        if (existing) {
            setVehicle(existing);
            setIsLoading(false);
            setNotFound(false);
        } else {
            setIsLoading(true);
        }

        const controller = new AbortController();
        setError(null);

        retryTransient(
            () => getVehicle(id, controller.signal),
            controller.signal,
        )
            .then((loaded) => {
                rememberVehicle(loaded);
                setVehicle(loaded);
                setNotFound(false);
            })
            .catch((caught: unknown) => {
                if (controller.signal.aborted || isAbortError(caught)) {
                    return;
                }

                if (caught instanceof ApiError && caught.status === 404) {
                    setVehicle(undefined);
                    setNotFound(true);
                    return;
                }

                if (existing) {
                    return;
                }

                setError(
                    caught instanceof Error
                        ? caught.message
                        : "Fahrzeug konnte nicht geladen werden.",
                );
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsLoading(false);
                }
            });

        return () => controller.abort();
    }, [id, listEpoch]);

    useEffect(() => {
        if (id === null) {
            clearTelemetryFocus("detail");
            return;
        }

        setTelemetryFocus("detail", [id]);
        return () => clearTelemetryFocus("detail");
    }, [id]);

    const override = vehicle ? vehicleOverrides[vehicle.id] : undefined;
    const patched = vehicle && override ? { ...vehicle, ...override } : vehicle;

    return {
        vehicle: patched,
        isLoading: isLoading && !patched,
        error,
        notFound,
    };
};
