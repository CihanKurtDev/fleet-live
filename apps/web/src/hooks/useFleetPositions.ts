import { useEffect, useMemo, useState } from "react";
import {
    STREAM_FOCUS_MAX_IDS,
    type FleetPosition,
    type GeoBBox,
    type VehicleFilterId,
} from "@fleet-live/shared";

import { isAbortError } from "../api/client";
import { retryTransient } from "../api/retryTransient";
import {
    clearTelemetryFocus,
    setTelemetryFocus,
} from "../api/telemetryFocus";
import { listVehiclePositions } from "../api/vehicles";
import { useVehicles } from "../context/vehiclesContext";
import { applyVehicleOverrides } from "../utils/applyVehicleOverrides";

type FleetPositionsQueryInput = {
    bbox: GeoBBox | null;
    filter?: VehicleFilterId;
    search: string;
    drivers: string[];
};

export const useFleetPositions = ({
    bbox,
    filter,
    search,
    drivers,
}: FleetPositionsQueryInput) => {
    const { listEpoch, vehicleOverrides } = useVehicles();
    const [snapshot, setSnapshot] = useState<FleetPosition[]>([]);
    const [truncated, setTruncated] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!bbox) {
            return;
        }

        const controller = new AbortController();
        setIsLoading(true);

        retryTransient(
            () =>
                listVehiclePositions(
                    {
                        bbox,
                        filter,
                        search,
                        drivers,
                    },
                    controller.signal,
                ),
            controller.signal,
        )
            .then((response) => {
                setSnapshot(response.data);
                setTruncated(response.meta.truncated);
                setHasLoaded(true);
                setError(null);
            })
            .catch((caught: unknown) => {
                if (controller.signal.aborted || isAbortError(caught)) {
                    return;
                }

                setError(
                    caught instanceof Error
                        ? caught.message
                        : "Positionen konnten nicht geladen werden.",
                );
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsLoading(false);
                }
            });

        return () => controller.abort();
    }, [bbox, drivers, filter, listEpoch, search]);

    const vehicles = useMemo(
        () => applyVehicleOverrides(snapshot, vehicleOverrides),
        [snapshot, vehicleOverrides],
    );

    const drivingFocusKey = vehicles
        .filter((vehicle) => vehicle.status === "DRIVING")
        .map((vehicle) => vehicle.id)
        .slice(0, STREAM_FOCUS_MAX_IDS)
        .join(",");

    useEffect(() => {
        const ids = drivingFocusKey
            ? drivingFocusKey.split(",").map(Number)
            : [];

        setTelemetryFocus("fleet", ids);

        return () => clearTelemetryFocus("fleet");
    }, [drivingFocusKey]);

    return {
        vehicles,
        truncated,
        isLoading,
        hasLoaded,
        error,
        snapshotLength: snapshot.length,
    };
};
