import { useEffect, useMemo, useState } from "react";
import {
    STREAM_FOCUS_MAX_IDS,
    type FleetDensityCell,
    type FleetPosition,
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
import { useRetryTrigger } from "./useRetryTrigger";

type FleetPositionsQueryInput = {
    filter?: VehicleFilterId;
    drivers: string[];
    /** Text statt Namensliste (`driver_search`). */
    driverSearch?: string;
    /** Gewähltes Fahrzeug: bekommt Live-Daten, auch über der Fokus-Grenze. */
    pinnedId?: number | null;
};

export const useFleetPositions = ({
    filter,
    drivers,
    driverSearch = "",
    pinnedId = null,
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
        driverSearch,
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
                        driver_search: driverSearch || undefined,
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
    }, [drivers, driverSearch, filter, listEpoch, retryKey]);

    const vehicles = useMemo(
        () => applyVehicleOverrides(snapshot, vehicleOverrides),
        [snapshot, vehicleOverrides],
    );

    // Alle fahrenden Fahrzeuge, nicht nur die im Ausschnitt: sie bewegen sich
    // auch, wenn sie in einer Gruppe stecken oder gerade außerhalb liegen. Ein
    // Fahrzeug, das erst beim Heranzoomen einen Fokus bekäme, hätte dann eine
    // alte Position und spränge.
    const drivingIds = vehicles
        .filter(
            (vehicle) =>
                vehicle.status === "DRIVING" &&
                vehicle.has_position &&
                vehicle.latitude !== null &&
                vehicle.longitude !== null,
        )
        .map((vehicle) => vehicle.id);
    // Das gewählte Fahrzeug steht vorn, damit der Schnitt es nie abwirft.
    const drivingFocusKey = (
        pinnedId !== null && drivingIds.includes(pinnedId)
            ? [pinnedId, ...drivingIds.filter((id) => id !== pinnedId)]
            : drivingIds
    )
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
