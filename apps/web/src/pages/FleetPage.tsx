import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
    DEPOT_RADIUS_DEFAULT_M,
    LOW_FUEL_THRESHOLD_PERCENT,
    type Alert,
    type AlertType,
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
import { FleetEventFeed } from "../components/alerts/FleetEventFeed";
import { ConfirmDialog } from "../components/ui/Modal/ConfirmDialog";
import { Input } from "../components/ui/Input/Input";
import { RetryMessage } from "../components/ui/RetryMessage";
import { TableFilterBar } from "../components/ui/Table/TableFilterBar";
import { DepotPanel } from "../components/vehicles/DepotPanel";
import { DepotStrip } from "../components/vehicles/DepotStrip";
import {
    depotAfterClick,
    isDepotDraftDirty,
    type DepotDraft,
} from "../components/vehicles/depotDraft";
import { FleetDetailPanel } from "../components/vehicles/FleetDetailPanel";
import { FleetDriverPicker } from "../components/vehicles/FleetDriverPicker";
import {
    FleetKpiBand,
    type FleetKpiTile,
} from "../components/vehicles/FleetKpiBand";
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
    vehicleStatusLabel,
} from "../components/vehicles/vehicleStatus";
import { useVehicles } from "../context/vehiclesContext";
import { useAlertList } from "../hooks/useAlertList";
import { useAuth } from "../hooks/useAuth";
import { useBriefing } from "../hooks/useBriefing";
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

/** Neueste Warnungen in der Seitenleiste. */
const FLEET_EVENT_LIMIT = 25;

const STATUS_TONE: Record<VehicleStatus, FleetKpiTile["tone"]> = {
    DRIVING: "positive",
    IDLE: "neutral",
    STOPPED: "neutral",
    OFFLINE: "critical",
};

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
        vehicleId: selectedId,
        setVehicle: setSelectedId,
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
    const briefing = useBriefing();
    const [eventType, setEventType] = useState<AlertType | null>(null);
    const events = useAlertList({
        filter: "all",
        sort: "created_at",
        dir: "desc",
        page: 1,
        limit: FLEET_EVENT_LIMIT,
        type: eventType ?? undefined,
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
    const [focus, setFocus] = useState<{
        key: string;
        vehicle: FleetPosition;
    } | null>(null);
    const [frameNonce, setFrameNonce] = useState(0);
    const [searchOpen, setSearchOpen] = useState(false);
    // Set when a search hit is chosen: the panel then takes the focus.
    const [pickedId, setPickedId] = useState<number | null>(null);
    const searchWrapRef = useRef<HTMLDivElement>(null);

    // `?filter=driving|idle|offline` (Links von der Schicht) wird zum
    // Status-Chip; die URL behält nur die Serverfilter.
    const statusFromUrl = statusFromFilter(filter);

    if (statusFromUrl && statusFromUrl !== statusChip) {
        setStatusChip(statusFromUrl);
    }

    useEffect(() => {
        if (statusFromUrl) {
            setFilter(undefined);
        }
    }, [statusFromUrl, setFilter]);

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
    // Opened without a saved view (nav, Schicht): frame the whole fleet once
    // it has loaded, not a fixed Germany view that is a continent on a wide
    // screen.
    const [autoFrame, setAutoFrame] = useState(
        () => bbox === null && depotId === undefined,
    );
    if (autoFrame && hasLoaded && frameBounds) {
        setAutoFrame(false);
        setFrameNonce((current) => current + 1);
    }
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
    const vehiclePanelOpen = selectedVehicle !== null;

    // Closing the vehicle (Escape or Schließen) returns the focus to the
    // search field, where the user was looking for vehicles; the hit list
    // stays shut.
    const closeVehicle = useCallback(() => {
        setSelectedId(null);
        setPickedId(null);
        searchWrapRef.current?.querySelector("input")?.focus();
        setSearchOpen(false);
    }, [setSelectedId]);

    // Escape closes the innermost open thing on the map: the vehicle panel,
    // then a placement, then the selected depot. Dialogs, menus and the help
    // drawer take Escape first (they prevent the default).
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented) {
                return;
            }

            const target = event.target;

            if (
                document.querySelector("dialog[open]") ||
                (target instanceof Element &&
                    target.closest("input, textarea, select, [contenteditable='true']"))
            ) {
                return;
            }

            if (vehiclePanelOpen) {
                closeVehicle();
                return;
            }

            if (placing) {
                setPlacing(false);
                return;
            }

            if (draftDirty) {
                return;
            }

            if (draft !== null || depotId !== undefined) {
                setDraft(null);
                setSaveError(null);
                setDepot(null);
            }
        };

        window.addEventListener("keydown", onKey);

        return () => window.removeEventListener("keydown", onKey);
    }, [
        vehiclePanelOpen,
        placing,
        draft,
        draftDirty,
        depotId,
        setDepot,
        closeVehicle,
    ]);
    const showDepotPanel =
        placing ||
        draft !== null ||
        depotId !== undefined ||
        saveError !== null;
    const statusReady = hasLoaded && !error;
    const counts = briefing.data?.counts ?? null;
    const toggleServerFilter = (id: VehicleFilterId) => {
        setFilter(filter === id ? undefined : id);
    };
    const kpiTiles: FleetKpiTile[] = [
        ...MAP_STATUS_LEGEND.map((status): FleetKpiTile => {
            const totals = statusTotals[status];
            const label = vehicleStatusLabel(status);

            return {
                key: status,
                label,
                value: statusReady ? totals.fleet : null,
                hint: statusReady
                    ? `${formatCount(totals.inView)} im Ausschnitt`
                    : undefined,
                tone: STATUS_TONE[status],
                pressed: mode === "positions" && statusChip === status,
                disabled: !statusReady || mode === "density",
                ariaLabel: statusReady
                    ? `${label}, ${formatCount(totals.inView)} im Ausschnitt, ${formatCount(totals.fleet)} gesamt`
                    : label,
                onToggle: () =>
                    setStatusChip((current) =>
                        current === status ? null : status,
                    ),
            };
        }),
        {
            key: "speeding",
            label: "Tempo jetzt",
            value: counts?.speeding ?? null,
            hint: "laufende Überschreitungen",
            tone: "critical",
            pressed: filter === "speeding",
            onToggle: () => toggleServerFilter("speeding"),
        },
        {
            key: "low_fuel",
            label: "Wenig Tank",
            value: counts?.low_fuel ?? null,
            hint: `unter ${LOW_FUEL_THRESHOLD_PERCENT} % Tank`,
            tone: "warning",
            pressed: filter === "low_fuel",
            onToggle: () => toggleServerFilter("low_fuel"),
        },
    ];
    const inboxHref = `/alerts?filter=all${eventType ? `&type=${eventType}` : ""}`;

    const pickVehicle = (vehicle: FleetPosition) => {
        setSearchOpen(false);
        setSelectedId(vehicle.id);
        setPickedId(vehicle.id);

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

    const pickEvent = (alert: Alert) => {
        const vehicle =
            mode === "positions"
                ? vehicles.find((item) => item.id === alert.vehicle_id)
                : undefined;

        if (vehicle?.has_position) {
            pickVehicle(vehicle);
            return;
        }

        navigate(`/vehicles/${alert.vehicle_id}`, {
            viewTransition: true,
            state: { from: fleetPath },
        });
    };

    const rejectDirtyDepot = () => {
        setSaveError("Speichern oder abbrechen, um ein anderes Depot zu wählen.");
    };

    // Deselect: the map highlight, the panel and the `depot` URL parameter
    // all follow `depotId`, so clearing it resets them together.
    const clearDepot = () => {
        setDraft(null);
        setPlacing(false);
        setSaveError(null);
        setDepot(null);
    };

    const selectDepot = (site: Site) => {
        if (draft && isDepotDraftDirty(draft, sites)) {
            rejectDirtyDepot();
            return;
        }

        // A second click on the selected depot deselects it.
        if (depotAfterClick(depotId, site.id, draft !== null || placing) === null) {
            clearDepot();
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

    const startPlaceDepot = () => {
        if (draft && isDepotDraftDirty(draft, sites)) {
            rejectDirtyDepot();
            return;
        }

        setPlacing((current) => !current);
        setDraft(null);
        setSaveError(null);
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
            <div className={styles.kpis}>
                <FleetKpiBand tiles={kpiTiles} />
                {briefing.error && (
                    <RetryMessage
                        message={briefing.error}
                        onRetry={briefing.retry}
                    />
                )}
            </div>
            <div className={styles.body}>
                <div className={styles.main}>
                    <div className={styles.toolbar}>
                        <div className={styles.searchWrap} ref={searchWrapRef}>
                            <Input
                                type="search"
                                size="sm"
                                className={styles.search}
                                placeholder="Kennzeichen oder Fahrer"
                                aria-label="Kennzeichen oder Fahrer"
                                aria-expanded={
                                    searchOpen && searchDraft.trim().length > 0
                                }
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
                                    {mode === "positions" &&
                                        hits.length === 0 && (
                                            <li className={styles.hitNote}>
                                                Kein Treffer
                                            </li>
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
                                                    {hit.driver_name ??
                                                        "Kein Fahrer"}
                                                </span>
                                                <span>
                                                    {vehicleStatusLabel(
                                                        hit.status,
                                                    )}
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
                                statusFromFilter(filter)
                                    ? null
                                    : (filter ?? null)
                            }
                            onFilterChange={(id) =>
                                setFilter(
                                    (id as VehicleFilterId | null) ?? undefined,
                                )
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
                                                setShowWithoutPosition(
                                                    (open) => !open,
                                                )
                                            }
                                        >
                                            {formatCount(withoutPosition)} ohne
                                            Position
                                        </button>
                                    ) : (
                                        <span>
                                            {formatCount(withoutPosition)} ohne
                                            Position
                                        </span>
                                    )}
                                </p>
                            )}
                            {error && (
                                <RetryMessage message={error} onRetry={retry} />
                            )}
                        </div>
                    </div>
                    {hasLoaded && !error && mode === "density" && (
                        <p className={styles.noteBar}>
                            Dichteansicht ab 5.000 Fahrzeugen mit Position: die
                            Zahlen sind Zellensummen. Ein Status blendet darin
                            keine einzelnen Fahrzeuge aus.
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
                                                navigate(
                                                    `/vehicles/${vehicle.id}`,
                                                    {
                                                        viewTransition: true,
                                                        state: {
                                                            from: fleetPath,
                                                        },
                                                    },
                                                )
                                            }
                                        >
                                            <span>{vehicle.license_plate}</span>
                                            <span>
                                                {vehicle.driver_name ??
                                                    "Kein Fahrer"}
                                            </span>
                                            <span>
                                                {vehicleStatusLabel(
                                                    vehicle.status,
                                                )}
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}

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
                                const site = sites.find(
                                    (item) => item.id === id,
                                );

                                if (site) {
                                    selectDepot(site);
                                }
                            }}
                        />
                        {showDepotPanel && (
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
                                onDeselect={clearDepot}
                                onEdit={editDepot}
                                onStartPlace={startPlaceDepot}
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
                        )}
                        {hasLoaded && !error && emptyMessage && (
                            <p className={styles.empty} role="status">
                                {emptyMessage}
                            </p>
                        )}
                    </div>
                    <DepotStrip
                        sites={sites}
                        selectedId={depotId ?? null}
                        canEdit={canEdit}
                        placing={placing}
                        editing={draft !== null}
                        loadError={sitesError}
                        onRetry={() =>
                            setSitesRetryKey((current) => current + 1)
                        }
                        onSelect={selectDepot}
                        onStartPlace={startPlaceDepot}
                    />
                </div>
                <aside className={styles.side} aria-label="Ereignisse">
                    {selectedVehicle && (
                        <div className={styles.detail}>
                            <FleetDetailPanel
                                key={selectedVehicle.id}
                                vehicle={selectedVehicle}
                                from={fleetPath}
                                onClose={closeVehicle}
                                focusOnOpen={pickedId === selectedVehicle.id}
                            />
                        </div>
                    )}
                    <FleetEventFeed
                        alerts={events.data}
                        typeCounts={events.meta?.type_counts}
                        activeType={eventType}
                        selectedVehicleId={selectedId}
                        isLoading={events.isLoading}
                        error={events.error}
                        inboxHref={inboxHref}
                        onTypeChange={setEventType}
                        onPick={pickEvent}
                        onRetry={events.retry}
                    />
                </aside>
            </div>
            <ConfirmDialog
                open={deleteTarget !== null}
                onClose={() => setDeleteTarget(null)}
                title="Depot löschen?"
                confirmLabel="Löschen"
                busyLabel="Wird gelöscht…"
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
