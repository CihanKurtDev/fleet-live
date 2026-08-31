import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
    FLEET_DRIVERS_MAX,
    STREAM_FOCUS_MAX_IDS,
    isVehicleFilterId,
    type FleetPosition,
    type GeoBBox,
    type Vehicle,
    type VehicleFilterId,
} from "@fleet-live/shared";

import { isAbortError } from "../api/client";
import { retryTransient } from "../api/retryTransient";
import {
    clearTelemetryFocus,
    setTelemetryFocus,
} from "../api/telemetryFocus";
import { listVehiclePositions } from "../api/vehicles";
import { FleetDriverPicker } from "../components/vehicles/FleetDriverPicker";
import { FleetMap } from "../components/vehicles/FleetMap";
import { vehicleFilters } from "../components/vehicles/vehicleTableConfig";
import { useVehicles } from "../context/vehiclesContext";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { formatCount } from "../utils/formatCount";
import styles from "./FleetPage.module.scss";

const readDrivers = (params: URLSearchParams): string[] => {
    const names = params
        .getAll("drivers")
        .flatMap((entry) => entry.split(","))
        .map((name) => name.trim())
        .filter((name) => name.length > 0);

    return [...new Set(names)].slice(0, FLEET_DRIVERS_MAX);
};

const writeDrivers = (params: URLSearchParams, names: string[]) => {
    params.delete("drivers");

    for (const name of names) {
        params.append("drivers", name);
    }
};

const sameBBox = (left: GeoBBox | null, right: GeoBBox) =>
    left !== null &&
    left.west === right.west &&
    left.south === right.south &&
    left.east === right.east &&
    left.north === right.north;

const applyOverrides = (
    rows: FleetPosition[],
    overrides: Record<number, Partial<Vehicle>>,
): FleetPosition[] => {
    if (Object.keys(overrides).length === 0) {
        return rows;
    }

    return rows.map((row) => {
        const patch = overrides[row.id];

        if (!patch) {
            return row;
        }

        return {
            ...row,
            status: patch.status ?? row.status,
            latitude: patch.latitude ?? row.latitude,
            longitude: patch.longitude ?? row.longitude,
            speed: patch.speed ?? row.speed,
            recorded_at: patch.recorded_at ?? row.recorded_at,
        };
    });
};

export const FleetPage = () => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { listEpoch, vehicleOverrides } = useVehicles();
    const filterParam = searchParams.get("filter");
    const filter = isVehicleFilterId(filterParam) ? filterParam : undefined;
    const searchParam = searchParams.get("search") ?? "";
    const selectedDrivers = useMemo(
        () => readDrivers(searchParams),
        [searchParams],
    );
    const hasSelection = selectedDrivers.length > 0;
    const [searchDraft, setSearchDraft] = useState(searchParam);
    const debouncedSearch = useDebouncedValue(searchDraft);

    const [bbox, setBbox] = useState<GeoBBox | null>(null);
    const [snapshot, setSnapshot] = useState<FleetPosition[]>([]);
    const [truncated, setTruncated] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setSearchDraft(searchParam);
    }, [searchParam]);

    useEffect(() => {
        if (!hasSelection || debouncedSearch === searchParam) {
            return;
        }

        const params = new URLSearchParams(searchParams);

        if (debouncedSearch) {
            params.set("search", debouncedSearch);
        } else {
            params.delete("search");
        }

        setSearchParams(params, { replace: true });
    }, [debouncedSearch, hasSelection, searchParam, searchParams, setSearchParams]);

    useEffect(() => {
        if (!hasSelection) {
            setSnapshot([]);
            setTruncated(false);
            setHasLoaded(false);
            setIsLoading(false);
            setError(null);
            return;
        }

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
                        search: searchParam,
                        drivers: selectedDrivers,
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
    }, [bbox, filter, hasSelection, searchParam, selectedDrivers, listEpoch]);

    const vehicles = useMemo(
        () => applyOverrides(snapshot, vehicleOverrides),
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

    const patchParams = (mutate: (params: URLSearchParams) => void) => {
        const params = new URLSearchParams(searchParams);
        mutate(params);
        setSearchParams(params, { replace: true });
    };

    const setFilter = (next: VehicleFilterId | undefined) => {
        patchParams((params) => {
            if (next) {
                params.set("filter", next);
            } else {
                params.delete("filter");
            }
        });
    };

    const handleBoundsChange = (next: GeoBBox) => {
        setBbox((current) => (sameBBox(current, next) ? current : next));
    };

    const countLabel = `${formatCount(vehicles.length)} ${vehicles.length === 1 ? "Fahrzeug" : "Fahrzeuge"}`;

    return (
        <section className={styles.page}>
            <h1 className={styles.title}>Flottenkarte</h1>
            <div className={styles.toolbar}>
                <input
                    type="search"
                    className={styles.search}
                    placeholder="Kennzeichen"
                    aria-label={
                        hasSelection
                            ? "Kennzeichen in der Auswahl"
                            : "Kennzeichen"
                    }
                    title={
                        hasSelection
                            ? undefined
                            : "Zuerst Fahrer wählen"
                    }
                    value={searchDraft}
                    disabled={!hasSelection}
                    onChange={(event) => setSearchDraft(event.target.value)}
                />

                <FleetDriverPicker
                    selected={selectedDrivers}
                    onChange={(names) =>
                        patchParams((params) => {
                            writeDrivers(params, names);

                            if (names.length === 0) {
                                params.delete("search");
                                params.delete("filter");
                            }
                        })
                    }
                />

                <div
                    className={styles.chips}
                    role="group"
                    aria-label="Status"
                    aria-disabled={!hasSelection}
                    title={
                        hasSelection ? undefined : "Zuerst Fahrer wählen"
                    }
                >
                    <button
                        type="button"
                        className={styles.chip}
                        aria-pressed={hasSelection && filter === undefined}
                        disabled={!hasSelection}
                        title={
                            hasSelection
                                ? undefined
                                : "Zuerst Fahrer wählen"
                        }
                        onClick={() => setFilter(undefined)}
                    >
                        Alle
                    </button>
                    {vehicleFilters.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            className={styles.chip}
                            aria-pressed={hasSelection && filter === item.id}
                            disabled={!hasSelection}
                            title={
                                hasSelection
                                    ? undefined
                                    : "Zuerst Fahrer wählen"
                            }
                            onClick={() =>
                                setFilter(
                                    filter === item.id ? undefined : item.id,
                                )
                            }
                        >
                            {item.displayText}
                        </button>
                    ))}
                </div>

                <div className={styles.meta}>
                    {hasSelection &&
                        isLoading &&
                        snapshot.length === 0 &&
                        !truncated && (
                            <p className={styles.note}>
                                Positionen werden geladen…
                            </p>
                        )}
                    {hasSelection && hasLoaded && !error && !truncated && (
                        <p className={styles.count} aria-live="polite">
                            {countLabel}
                        </p>
                    )}
                    {error && (
                        <p className={styles.error} role="alert">
                            {error}
                        </p>
                    )}
                </div>
            </div>

            <div className={styles.mapArea}>
                <FleetMap
                    vehicles={vehicles}
                    onBoundsChange={handleBoundsChange}
                    onSelect={(id) =>
                        navigate(`/vehicles/${id}`, {
                            state: {
                                from: `/fleet${
                                    searchParams.toString()
                                        ? `?${searchParams.toString()}`
                                        : ""
                                }`,
                            },
                        })
                    }
                />
                {!hasSelection && !error && (
                    <p className={styles.empty} role="status">
                        Wähle Fahrer, um Fahrzeuge auf der Karte zu sehen.
                    </p>
                )}
                {hasSelection &&
                    hasLoaded &&
                    vehicles.length === 0 &&
                    !error && (
                        <p className={styles.empty} role="status">
                            {truncated
                                ? "Zu viele Fahrzeuge in diesem Ausschnitt. Zoome näher oder schränke die Auswahl ein."
                                : "Keine Fahrzeuge mit Position in diesem Ausschnitt."}
                        </p>
                    )}
            </div>
        </section>
    );
};
