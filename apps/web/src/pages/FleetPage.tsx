import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
    DEPOT_RADIUS_DEFAULT_M,
    type FleetPosition,
    type Site,
    type VehicleFilterId,
    type VehicleStatus,
} from "@fleet-live/shared";

import { ApiError, isAbortError } from "../api/client";
import {
    createSite,
    deleteSite,
    listSites,
    updateSite,
} from "../api/sites";
import { ConfirmDialog } from "../components/ui/Modal/ConfirmDialog";
import { Input } from "../components/ui/Input/Input";
import { RetryMessage } from "../components/ui/RetryMessage";
import { TableFilterBar } from "../components/ui/Table/TableFilterBar";
import { DepotPanel } from "../components/vehicles/DepotPanel";
import {
    isDepotDraftDirty,
    type DepotDraft,
} from "../components/vehicles/depotDraft";
import { FleetDetailPanel } from "../components/vehicles/FleetDetailPanel";
import { FleetDriverPicker } from "../components/vehicles/FleetDriverPicker";
import { FleetMap } from "../components/vehicles/FleetMap";
import { FleetStreamStatus } from "../components/vehicles/FleetStreamStatus";
import { isInsideBBox } from "../components/vehicles/clusterFleet";
import {
    countDensityStatus,
    countFleetStatus,
    filterByStatus,
    fleetBounds,
    fleetEmptyMessage,
    plateHits,
    unionBBoxes,
} from "../components/vehicles/fleetOverview";
import { vehicleFilters } from "../components/vehicles/vehicleTableConfig";
import {
    MAP_STATUS_LEGEND,
    VEHICLE_STATUS_COLORS,
    vehicleStatusLabel,
} from "../components/vehicles/vehicleStatus";
import { useVehicles } from "../context/vehiclesContext";
import { useAuth } from "../hooks/useAuth";
import { useFleetPageQuery } from "../hooks/useFleetPageQuery";
import { useFleetPositions } from "../hooks/useFleetPositions";
import { formatCount } from "../utils/formatCount";
import styles from "./FleetPage.module.scss";

const fleetServerFilters = vehicleFilters.filter((item) =>
    item.id === "alerts" ||
    item.id === "low_fuel" ||
    item.id === "unassigned" ||
    item.id === "in_depot",
);

const statusFromFilter = (
    filter: VehicleFilterId | undefined,
): VehicleStatus | null => {
    if (filter === "driving") {
        return "DRIVING";
    }

    if (filter === "idle") {
        return "IDLE";
    }

    if (filter === "offline") {
        return "OFFLINE";
    }

    return null;
};

const sortSites = (sites: Site[]) =>
    [...sites].sort(
        (left, right) =>
            left.name.localeCompare(right.name, "de") || left.id - right.id,
    );

export const FleetPage = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { listEpoch, streamConnection, lastTelemetryAt } = useVehicles();
    const canEdit = user?.role === "dispatcher";
    const {
        bbox,
        filter,
        drivers,
        depotId,
        searchDraft,
        setSearchDraft,
        setFilter,
        setDrivers,
        setBBox,
        setDepot,
        searchParams,
    } = useFleetPageQuery();
    const {
        vehicles,
        densityCells,
        mode,
        total,
        withoutPosition,
        isLoading,
        hasLoaded,
        error,
        retry,
        snapshotLength,
    } = useFleetPositions({
        bbox,
        filter: statusFromFilter(filter) ? undefined : filter,
        drivers,
    });
    const [sites, setSites] = useState<Site[]>([]);
    const [sitesError, setSitesError] = useState<string | null>(null);
    const [sitesRetryKey, setSitesRetryKey] = useState(0);
    const [draft, setDraft] = useState<DepotDraft | null>(null);
    const [placing, setPlacing] = useState(false);
    const [focusNonce, setFocusNonce] = useState(0);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<Site | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showWithoutPosition, setShowWithoutPosition] = useState(false);
    const [statusChip, setStatusChip] = useState<VehicleStatus | null>(() =>
        statusFromFilter(filter),
    );
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [focus, setFocus] = useState<{
        key: string;
        vehicle: FleetPosition;
    } | null>(null);
    const [frameNonce, setFrameNonce] = useState(0);
    const [searchOpen, setSearchOpen] = useState(false);
    const searchWrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const fromUrl = statusFromFilter(filter);

        if (!fromUrl) {
            return;
        }

        setStatusChip(fromUrl);
        setFilter(undefined);
    }, [filter, setFilter]);

    useEffect(() => {
        if (!searchOpen) {
            return;
        }

        const onPointerDown = (event: PointerEvent) => {
            if (!searchWrapRef.current?.contains(event.target as Node)) {
                setSearchOpen(false);
            }
        };

        document.addEventListener("pointerdown", onPointerDown);

        return () => document.removeEventListener("pointerdown", onPointerDown);
    }, [searchOpen]);

    useEffect(() => {
        const controller = new AbortController();

        listSites(controller.signal)
            .then((response) => {
                setSites(response.data);
                setSitesError(null);
            })
            .catch((caught: unknown) => {
                if (isAbortError(caught)) {
                    return;
                }

                setSitesError("Depots konnten nicht geladen werden.");
            });

        return () => controller.abort();
    }, [listEpoch, sitesRetryKey]);

    const missingVehicles = useMemo(
        () => vehicles.filter((vehicle) => !vehicle.has_position),
        [vehicles],
    );
    const queryString = searchParams.toString();
    const selectedVehicle =
        selectedId === null
            ? null
            : (vehicles.find((vehicle) => vehicle.id === selectedId) ?? null);
    const shownVehicles = useMemo(() => {
        const filtered =
            mode === "positions"
                ? filterByStatus(vehicles, statusChip)
                : vehicles;

        if (
            mode !== "positions" ||
            selectedVehicle === null ||
            !selectedVehicle.has_position ||
            selectedVehicle.latitude === null ||
            selectedVehicle.longitude === null ||
            filtered.some((vehicle) => vehicle.id === selectedVehicle.id)
        ) {
            return filtered;
        }

        return [...filtered, selectedVehicle];
    }, [mode, selectedVehicle, statusChip, vehicles]);
    const statusTotals = useMemo(
        () =>
            mode === "density"
                ? countDensityStatus(densityCells, bbox)
                : countFleetStatus(vehicles, bbox),
        [bbox, densityCells, mode, vehicles],
    );
    const frameBounds = useMemo(
        () =>
            mode === "density"
                ? unionBBoxes(densityCells.map((cell) => cell.bbox))
                : fleetBounds(shownVehicles),
        [densityCells, mode, shownVehicles],
    );
    const hits = useMemo(
        () => (mode === "positions" ? plateHits(vehicles, searchDraft) : []),
        [mode, searchDraft, vehicles],
    );
    const positionedCount = useMemo(
        () =>
            vehicles.filter(
                (vehicle) =>
                    vehicle.has_position &&
                    vehicle.latitude !== null &&
                    vehicle.longitude !== null,
            ).length,
        [vehicles],
    );
    const inViewCount = useMemo(() => {
        if (bbox === null) {
            return null;
        }

        return vehicles.filter(
            (vehicle) =>
                vehicle.has_position &&
                vehicle.latitude !== null &&
                vehicle.longitude !== null &&
                isInsideBBox(vehicle.latitude, vehicle.longitude, bbox),
        ).length;
    }, [bbox, vehicles]);
    const emptyMessage = fleetEmptyMessage({
        mode,
        rowCount: mode === "density" ? total : vehicles.length,
        positionedCount,
        inViewCount,
        hasNarrowingFilter: filter !== undefined || drivers.length > 0,
    });
    const fleetPath = `/fleet${queryString ? `?${queryString}` : ""}`;
    const draftDirty = draft !== null && isDepotDraftDirty(draft, sites);

    const pickVehicle = (vehicle: FleetPosition) => {
        setSearchOpen(false);
        setSelectedId(vehicle.id);

        if (
            vehicle.has_position &&
            vehicle.latitude !== null &&
            vehicle.longitude !== null
        ) {
            setFocus({
                key: `${vehicle.id}:${Date.now()}`,
                vehicle,
            });
        }
    };

    const rejectDirtyDepot = () => {
        setSaveError("Speichern oder abbrechen, um ein anderes Depot zu wählen.");
    };

    const selectDepot = (site: Site) => {
        if (draft && isDepotDraftDirty(draft, sites)) {
            rejectDirtyDepot();
            return;
        }

        setDraft(null);
        setPlacing(false);
        setSaveError(null);
        setDepot(site.id);
        setFocusNonce((current) => current + 1);
    };

    const editDepot = (site: Site) => {
        setPlacing(false);
        setSaveError(null);
        setDepot(site.id);
        setFocusNonce((current) => current + 1);
        setDraft({
            id: site.id,
            name: site.name,
            latitude: site.latitude,
            longitude: site.longitude,
            radius_m: site.radius_m,
        });
    };

    const saveDraft = async () => {
        if (!draft || draft.name.trim().length === 0) {
            return;
        }

        const input = {
            name: draft.name.trim(),
            latitude: draft.latitude,
            longitude: draft.longitude,
            radius_m: draft.radius_m,
        };

        setIsSaving(true);
        setSaveError(null);

        try {
            if (draft.id === "new") {
                const created = await createSite(input);
                setSites((current) => sortSites([...current, created]));
                setDepot(created.id);
                setFocusNonce((current) => current + 1);
            } else {
                const updated = await updateSite(draft.id, input);
                setSites((current) =>
                    sortSites(
                        current.map((site) =>
                            site.id === updated.id ? updated : site,
                        ),
                    ),
                );
            }

            setDraft(null);
            setPlacing(false);
        } catch (caught) {
            setSaveError(
                caught instanceof ApiError
                    ? caught.message
                    : "Depot konnte nicht gespeichert werden.",
            );
        } finally {
            setIsSaving(false);
        }
    };

    const confirmDelete = async () => {
        if (!deleteTarget) {
            return;
        }

        setIsDeleting(true);

        try {
            await deleteSite(deleteTarget.id);
            setSites((current) =>
                current.filter((site) => site.id !== deleteTarget.id),
            );
            if (depotId === deleteTarget.id) {
                setDepot(null);
            }
            setDraft(null);
            setDeleteTarget(null);
        } catch (caught) {
            setSaveError(
                caught instanceof ApiError
                    ? caught.message
                    : "Depot konnte nicht gelöscht werden.",
            );
            setDeleteTarget(null);
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <section className={styles.page}>
            <h1 className={styles.title}>Flottenkarte</h1>
            <div className={styles.toolbar}>
                <div className={styles.searchWrap} ref={searchWrapRef}>
                    <Input
                        type="search"
                        size="sm"
                        className={styles.search}
                        placeholder="Kennzeichen oder Fahrer"
                        aria-label="Kennzeichen oder Fahrer"
                        aria-expanded={searchOpen && searchDraft.trim().length > 0}
                        aria-controls="fleet-search-hits"
                        value={searchDraft}
                        onChange={(event) => {
                            setSearchDraft(event.target.value);
                            setSearchOpen(true);
                        }}
                        onFocus={() => setSearchOpen(true)}
                        onKeyDown={(event) => {
                            if (event.key === "Escape") {
                                setSearchOpen(false);
                            }

                            if (event.key === "Enter" && hits[0]) {
                                event.preventDefault();
                                pickVehicle(hits[0]);
                            }
                        }}
                    />
                    {searchOpen && searchDraft.trim().length > 0 && (
                        <ul
                            id="fleet-search-hits"
                            className={styles.hits}
                            role="listbox"
                        >
                            {mode === "density" && (
                                <li className={styles.hitNote}>
                                    In der Dichteansicht gibt es keine
                                    einzelnen Kennzeichen.
                                </li>
                            )}
                            {mode === "positions" && hits.length === 0 && (
                                <li className={styles.hitNote}>Kein Treffer</li>
                            )}
                            {hits.map((hit) => (
                                <li key={hit.id}>
                                    <button
                                        type="button"
                                        role="option"
                                        onClick={() => pickVehicle(hit)}
                                    >
                                        <span>{hit.license_plate}</span>
                                        <span>
                                            {hit.driver_name ?? "Kein Fahrer"}
                                        </span>
                                        <span>
                                            {vehicleStatusLabel(hit.status)}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <FleetDriverPicker
                    selected={drivers}
                    onChange={setDrivers}
                />

                <TableFilterBar
                    filters={fleetServerFilters}
                    activeFilterId={
                        statusFromFilter(filter) ? null : (filter ?? null)
                    }
                    onFilterChange={(id) =>
                        setFilter((id as VehicleFilterId | null) ?? undefined)
                    }
                    showAll
                    allLabel="Alle"
                    ariaLabel="Filter"
                />

                <div className={styles.meta}>
                    <FleetStreamStatus
                        connection={streamConnection}
                        lastTelemetryAt={lastTelemetryAt}
                    />
                    <button
                        type="button"
                        className={styles.frameAll}
                        disabled={frameBounds === null}
                        onClick={() =>
                            setFrameNonce((current) => current + 1)
                        }
                    >
                        Alle Fahrzeuge anzeigen
                    </button>
                    {isLoading &&
                        snapshotLength === 0 &&
                        densityCells.length === 0 && (
                            <p className={styles.note}>
                                Positionen werden geladen…
                            </p>
                        )}
                    {hasLoaded && !error && withoutPosition > 0 && (
                        <p className={styles.count}>
                            {mode === "positions" ? (
                                <button
                                    type="button"
                                    className={styles.missingToggle}
                                    aria-expanded={showWithoutPosition}
                                    onClick={() =>
                                        setShowWithoutPosition((open) => !open)
                                    }
                                >
                                    {formatCount(withoutPosition)} ohne Position
                                </button>
                            ) : (
                                <span>
                                    {formatCount(withoutPosition)} ohne Position
                                </span>
                            )}
                        </p>
                    )}
                    {error && (
                        <RetryMessage message={error} onRetry={retry} />
                    )}
                </div>
            </div>
            {hasLoaded && !error && (
                <div
                    className={styles.statusBar}
                    role="group"
                    aria-label="Status"
                >
                    {MAP_STATUS_LEGEND.map((status) => {
                        const totals = statusTotals[status];
                        const pressed =
                            mode === "positions" && statusChip === status;
                        const density = mode === "density";

                        return (
                            <button
                                key={status}
                                type="button"
                                className={
                                    pressed
                                        ? `${styles.statusChip} ${styles.statusChipOn}`
                                        : styles.statusChip
                                }
                                aria-pressed={pressed}
                                disabled={density}
                                onClick={() => {
                                    setStatusChip((current) =>
                                        current === status ? null : status,
                                    );
                                }}
                            >
                                <span
                                    className={styles.statusDot}
                                    style={{
                                        background:
                                            VEHICLE_STATUS_COLORS[status],
                                    }}
                                />
                                <span>{vehicleStatusLabel(status)}</span>
                                <span className={styles.statusCount}>
                                    {formatCount(totals.inView)} im Ausschnitt
                                    / {formatCount(totals.fleet)} gesamt
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
            {hasLoaded && !error && mode === "density" && (
                <p className={styles.noteBar}>
                    Dichteansicht ab 5.000 Fahrzeugen mit Position: die Zahlen
                    sind Zellensummen. Ein Status blendet darin keine
                    einzelnen Fahrzeuge aus.
                </p>
            )}
            {showWithoutPosition &&
                withoutPosition > 0 &&
                mode === "positions" && (
                    <ul className={styles.missingList}>
                        {missingVehicles.map((vehicle) => (
                            <li key={vehicle.id}>
                                <button
                                    type="button"
                                    onClick={() =>
                                        navigate(`/vehicles/${vehicle.id}`, {
                                            state: {
                                                from: `/fleet${
                                                    queryString
                                                        ? `?${queryString}`
                                                        : ""
                                                }`,
                                            },
                                        })
                                    }
                                >
                                    <span>{vehicle.license_plate}</span>
                                    <span>
                                        {vehicle.driver_name ?? "Kein Fahrer"}
                                    </span>
                                    <span>
                                        {vehicleStatusLabel(vehicle.status)}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

            <div className={styles.stage}>
            <div className={styles.mapArea}>
                <FleetMap
                    vehicles={shownVehicles}
                    densityCells={densityCells}
                    mode={mode}
                    initialBbox={bbox}
                    focusKey={focus?.key ?? null}
                    focusPosition={focus?.vehicle ?? null}
                    selectedId={selectedId}
                    frame={
                        frameNonce > 0 && frameBounds
                            ? { nonce: frameNonce, bounds: frameBounds }
                            : null
                    }
                    depots={sites}
                    draft={draft}
                    selectedDepotId={depotId ?? null}
                    focusDepot={
                        depotId
                            ? { id: depotId, nonce: focusNonce }
                            : null
                    }
                    placing={placing}
                    canEditDepots={canEdit}
                    lockDepotSelection={draftDirty}
                    onBoundsChange={setBBox}
                    onSelect={setSelectedId}
                    onPlaceDepot={(latitude, longitude) => {
                        setDraft({
                            id: "new",
                            name: "",
                            latitude,
                            longitude,
                            radius_m: DEPOT_RADIUS_DEFAULT_M,
                        });
                        setPlacing(false);
                        setSaveError(null);
                    }}
                    onMoveDepot={(id, latitude, longitude) => {
                        setDraft((current) =>
                            current && current.id === id
                                ? { ...current, latitude, longitude }
                                : current,
                        );
                    }}
                    onSelectDepot={(id) => {
                        const site = sites.find((item) => item.id === id);

                        if (site) {
                            selectDepot(site);
                        }
                    }}
                />
                <DepotPanel
                    sites={sites}
                    selectedId={depotId ?? null}
                    draft={canEdit ? draft : null}
                    placing={placing}
                    canEdit={canEdit}
                    saveError={saveError}
                    loadError={sitesError}
                    isSaving={isSaving}
                    revealToken={focusNonce}
                    onRetryLoad={() =>
                        setSitesRetryKey((current) => current + 1)
                    }
                    onSelect={selectDepot}
                    onEdit={editDepot}
                    onStartPlace={() => {
                        if (draft && isDepotDraftDirty(draft, sites)) {
                            rejectDirtyDepot();
                            return;
                        }

                        setPlacing((current) => !current);
                        setDraft(null);
                        setSaveError(null);
                    }}
                    onCancel={() => {
                        setDraft(null);
                        setPlacing(false);
                        setSaveError(null);
                    }}
                    onDraftChange={setDraft}
                    onSave={() => {
                        void saveDraft();
                    }}
                    onAskDelete={setDeleteTarget}
                />
                {hasLoaded && !error && emptyMessage && (
                    <p className={styles.empty} role="status">
                        {emptyMessage}
                    </p>
                )}
            </div>
            {selectedVehicle && (
                <aside className={styles.detail} aria-label="Fahrzeug">
                    <FleetDetailPanel
                        vehicle={selectedVehicle}
                        from={fleetPath}
                        onClose={() => setSelectedId(null)}
                    />
                </aside>
            )}
            </div>
            <ConfirmDialog
                open={deleteTarget !== null}
                onClose={() => setDeleteTarget(null)}
                title="Depot löschen?"
                confirmLabel="Löschen"
                isBusy={isDeleting}
                onConfirm={confirmDelete}
            >
                {deleteTarget && (
                    <p>
                        {deleteTarget.home_count === 0
                            ? `„${deleteTarget.name}“ ist bei keinem Fahrzeug der Stammstandort.`
                            : `${deleteTarget.home_count} ${
                                  deleteTarget.home_count === 1
                                      ? "Fahrzeug hat"
                                      : "Fahrzeuge haben"
                              } „${deleteTarget.name}“ als Stammstandort. Die Fahrzeuge bleiben, der Stammstandort wird geleert.`}
                    </p>
                )}
            </ConfirmDialog>
        </section>
    );
};
