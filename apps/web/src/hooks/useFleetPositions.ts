import { useEffect, useMemo, useState } from "react";
import {
    STREAM_FOCUS_MAX_IDS,
    type FleetDensityCell,
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
import { isInsideBBox } from "../components/vehicles/clusterFleet";
import { applyVehicleOverrides } from "../utils/applyVehicleOverrides";
import { useRetryTrigger } from "./useRetryTrigger";

type FleetPositionsQueryInput = {
    bbox: GeoBBox | null;
    filter?: VehicleFilterId;
    drivers: string[];
};

export const useFleetPositions = ({
    bbox,
    filter,
    drivers,
}: FleetPositionsQueryInput) => {
    const { listEpoch, vehicleOverrides } = useVehicles();
    const { retryKey, retry } = useRetryTrigger();
    const [snapshot, setSnapshot] = useState<FleetPosition[]>([]);
    const [densityCells, setDensityCells] = useState<FleetDensityCell[]>([]);
    const [mode, setMode] = useState<"positions" | "density">("positions");
    const [total, setTotal] = useState(0);
    const [matched, setMatched] = useState(0);
    const [withoutPosition, setWithoutPosition] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const driversKey = drivers.join("\0");
    // Bestand einmal laden. Der Ausschnitt filtert lokal, damit die
    // Zähler beim Schwenken nicht springen.
    const requestKey = [
        filter ?? "",
        driversKey,
        listEpoch,
        retryKey,
    ].join("\0");
    const [fetchKey, setFetchKey] = useState(requestKey);

    if (requestKey !== fetchKey) {
        setFetchKey(requestKey);
        setIsLoading(true);
        setError(null);
    }

    useEffect(() => {
        const controller = new AbortController();

        retryTransient(
            () =>
                listVehiclePositions(
                    {
                        filter,
                        drivers,
                    },
                    controller.signal,
                ),
            controller.signal,
        )
            .then((response) => {
                setMode(response.mode);
                setTotal(response.meta.total);
                setMatched(response.meta.matched);
                setWithoutPosition(response.meta.without_position);
                if (response.mode === "positions") {
                    setSnapshot(response.data);
                    setDensityCells([]);
                } else {
                    setSnapshot([]);
                    setDensityCells(response.data);
                }
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
    }, [drivers, filter, listEpoch, retryKey]);

    const vehicles = useMemo(
        () => applyVehicleOverrides(snapshot, vehicleOverrides),
        [snapshot, vehicleOverrides],
    );

    const drivingFocusKey = vehicles
        .filter(
            (vehicle) =>
                vehicle.status === "DRIVING" &&
                vehicle.has_position &&
                vehicle.latitude !== null &&
                vehicle.longitude !== null &&
                (bbox === null ||
                    isInsideBBox(vehicle.latitude, vehicle.longitude, bbox)),
        )
        .map((vehicle) => vehicle.id)
        .slice(0, STREAM_FOCUS_MAX_IDS)
        .join(",");

    useEffect(() => {
        if (mode === "density") {
            clearTelemetryFocus("fleet");
            return;
        }

        const ids = drivingFocusKey
            ? drivingFocusKey.split(",").map(Number)
            : [];

        setTelemetryFocus("fleet", ids);

        return () => clearTelemetryFocus("fleet");
    }, [drivingFocusKey, mode]);

    return {
        vehicles,
        densityCells,
        mode,
        total,
        matched,
        withoutPosition,
        isLoading,
        hasLoaded,
        error,
        retry,
        snapshotLength: snapshot.length,
    };
};
