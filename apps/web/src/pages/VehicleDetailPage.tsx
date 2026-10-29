import {
    VEHICLE_TYPE_LABELS,
    berlinTodayIso,
    dueExplanationText,
    explainHuMonth,
    explainUvv,
    isLowFuelLevel,
} from "@fleet-live/shared";
import { decodePolyline, speedBand } from "@fleet-live/shared";
import type {
    Trip,
    TripEvent,
    TripListItem,
    VehicleInput,
} from "@fleet-live/shared";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import { resolveAlerts } from "../api/alerts";
import { isAbortError } from "../api/client";
import { retryTransient } from "../api/retryTransient";
import {
    getVehicleTelemetry,
    getVehicleTripById,
    listVehicleTrips,
} from "../api/vehicles";
import { VehicleHintsPanel } from "../components/alerts/VehicleHintsPanel";
import { DetailBackLink } from "../components/navigation/DetailBackLink";
import { useDetailBack } from "../components/navigation/useDetailBack";
import { VehicleAssignmentPanel } from "../components/vehicles/VehicleAssignmentPanel";
import {
    VehicleForm,
    type VehicleFormField,
} from "../components/vehicles/VehicleForm";
import {
    VehicleMap,
    type MapPoint,
} from "../components/vehicles/VehicleMap";
import { VehicleTripArchive } from "../components/vehicles/VehicleTripArchive";
import type { TripFocusInfo } from "../components/vehicles/TripFocus";
import { useTripCache } from "../components/vehicles/useTripCache";
import { VehicleMoreMenu } from "../components/vehicles/VehicleMoreMenu";
import type { PlaybackFix } from "../components/vehicles/vehiclePlayback";
import { pathLength, toLatLngs } from "../components/vehicles/mapGeometry";
import { SPEED_BAND_COLORS, speedBandTitle } from "../components/vehicles/speedBand";
import {
    AvailabilityChip,
    VehicleStatusChip,
} from "../components/vehicles/VehicleStatusChip";
import {
    WorkshopPanel,
    type PageNotice,
} from "../components/vehicles/WorkshopPanel";
import { setVehicleOutOfService } from "../api/workshop";
import { vehicleStatusLabel } from "../components/vehicles/vehicleStatus";
import { Button } from "../components/ui/Button/Button";
import { ConfirmDialog } from "../components/ui/Modal/ConfirmDialog";
import { Modal } from "../components/ui/Modal/Modal";
import { RetryMessage } from "../components/ui/RetryMessage";
import { useVehicles } from "../context/vehiclesContext";
import { useAuth } from "../hooks/useAuth";
import { usePageTitle } from "../hooks/usePageTitle";
import { useVehicle } from "../hooks/useVehicle";
import {
    formatIsoDate,
    formatYearMonth,
    formatRelativeTimestamp,
    formatTimestamp,
} from "../utils/dateTime";
import layout from "../styles/detailLayout.module.scss";
import styles from "./VehicleDetailPage.module.scss";

const formatCoordinate = (
    value: number,
    positive: string,
    negative: string,
) =>
    `${Math.abs(value).toLocaleString("de-DE", {
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
    })}° ${value < 0 ? negative : positive}`;

const formatKilometerValue = (meters: number) =>
    (meters / 1_000).toLocaleString("de-DE", {
        maximumFractionDigits: 1,
    });

const formatKilometers = (meters: number) =>
    `${formatKilometerValue(meters)} km`;

const describeTrip = (trip: TripListItem): string => {
    if (trip.ended_at === null) {
        return `Fahrt läuft seit ${formatTimestamp(trip.started_at)}.`;
    }

    return `${formatTimestamp(trip.started_at)} – ${formatTimestamp(trip.ended_at)} · ${formatKilometers(
        trip.distance_m,
    )} · Spitze ${Math.round(trip.max_speed)} km/h`;
};

/** Enough stored fixes to cover the playback delay of up to 10 s. */
const PLAYBACK_HISTORY_LIMIT = 10;

export const VehicleDetailPage = () => {
    const { id } = useParams();
    const { from, navigate } = useDetailBack("/vehicles");
    const {
        updateVehicle,
        deleteVehicles,
        subscribeTripPath,
        listEpoch,
        refetchLists,
    } = useVehicles();
    const { user } = useAuth();
    const canWrite = user?.role === "dispatcher";

    const vehicleId = Number(id);
    const parsedId = Number.isInteger(vehicleId) ? vehicleId : null;
    const { vehicle, isLoading, error, retry, notFound } =
        useVehicle(parsedId);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isEditingMaster, setIsEditingMaster] = useState(false);
    const [notice, setNotice] = useState<PageNotice>(null);
    const [confirmOutOfService, setConfirmOutOfService] = useState(false);
    const [isChangingService, setIsChangingService] = useState(false);
    const [serviceError, setServiceError] = useState<string | null>(null);
    const [masterField, setMasterField] = useState<VehicleFormField | undefined>();
    const [tripVehicleId, setTripVehicleId] = useState(parsedId);
    const [livePath, setLivePath] = useState("");
    const [archiveTrips, setArchiveTrips] = useState<TripListItem[]>([]);
    const [archivePage, setArchivePage] = useState(1);
    const [archiveLimit, setArchiveLimit] = useState(10);
    const [archivePageCount, setArchivePageCount] = useState(1);
    const [archiveTotal, setArchiveTotal] = useState(0);
    // The trip list is fetched as soon as the page has a vehicle id.
    const [archiveLoading, setArchiveLoading] = useState(parsedId !== null);
    const [archiveError, setArchiveError] = useState<string | null>(null);
    const [archiveRetryKey, setArchiveRetryKey] = useState(0);
    const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
    const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
    /** The trip clicked in the list: the map frames it (not the first one picked on load). */
    const [focusTripId, setFocusTripId] = useState<number | null>(null);
    /** The trip framed on the map, kept while the next picked one loads. */
    const [framedTripId, setFramedTripId] = useState<number | null>(null);
    const tripCache = useTripCache(parsedId);
    /** The framed trip's events, reloaded after a change. */
    const [focusEvents, setFocusEvents] = useState<{
        tripId: number;
        events: TripEvent[];
    } | null>(null);
    const [eventsReload, setEventsReload] = useState(0);
    /** Stored fixes that start the map's playback (see VehiclePlayback). */
    const [playbackHistory, setPlaybackHistory] = useState<{
        vehicleId: number;
        fixes: PlaybackFix[];
    } | null>(null);

    if (parsedId !== tripVehicleId) {
        setTripVehicleId(parsedId);
        setLivePath("");
        setArchiveTrips([]);
        setArchivePage(1);
        setArchiveLimit(10);
        setArchiveError(null);
        setSelectedTripId(null);
        setSelectedTrip(null);
        setFocusTripId(null);
        setFocusEvents(null);
    }

    const vehicleStatus = vehicle?.status;
    const archiveIdentityKey =
        parsedId === null
            ? null
            : `${parsedId}\0${archivePage}\0${archiveLimit}\0${archiveRetryKey}`;
    const [prevArchiveIdentityKey, setPrevArchiveIdentityKey] =
        useState(archiveIdentityKey);

    if (archiveIdentityKey !== prevArchiveIdentityKey) {
        setPrevArchiveIdentityKey(archiveIdentityKey);
        if (archiveIdentityKey !== null) {
            setArchiveLoading(true);
            setArchiveError(null);
        } else {
            setArchiveLoading(false);
        }
    }

    const tripSelectionKey =
        parsedId === null || selectedTripId === null
            ? null
            : `${parsedId}\0${selectedTripId}`;
    const [prevTripSelectionKey, setPrevTripSelectionKey] =
        useState(tripSelectionKey);

    if (tripSelectionKey !== prevTripSelectionKey) {
        setPrevTripSelectionKey(tripSelectionKey);

        if (tripSelectionKey === null) {
            setSelectedTrip(null);
        }
    }

    const [prevVehicleStatus, setPrevVehicleStatus] = useState(vehicleStatus);
    if (vehicleStatus !== prevVehicleStatus) {
        setPrevVehicleStatus(vehicleStatus);
        if (vehicleStatus && vehicleStatus !== "DRIVING") {
            setLivePath("");
        }
    }

    const drivingId = vehicleStatus === "DRIVING" ? parsedId : null;

    // Once per vehicle while it drives: the last stored fixes, so the marker
    // moves from the first moment instead of waiting for the next report.
    useEffect(() => {
        if (drivingId === null) {
            return;
        }

        const controller = new AbortController();

        getVehicleTelemetry(drivingId, PLAYBACK_HISTORY_LIMIT, controller.signal)
            .then((response) => {
                setPlaybackHistory({
                    vehicleId: drivingId,
                    fixes: response.data.map((point) => ({
                        lat: point.latitude,
                        lng: point.longitude,
                        recordedAt: point.recorded_at,
                    })),
                });
            })
            .catch((caught: unknown) => {
                if (!isAbortError(caught)) {
                    // Without history the marker starts with the next report.
                    setPlaybackHistory({ vehicleId: drivingId, fixes: [] });
                }
            });

        return () => controller.abort();
    }, [drivingId]);

    useEffect(() => {
        if (parsedId === null) {
            return;
        }

        return subscribeTripPath((vehicleId, delta, reset) => {
            if (vehicleId !== parsedId) {
                return;
            }

            setSelectedTrip((current) => {
                if (!current || current.ended_at !== null) {
                    return current;
                }

                if (reset) {
                    return {
                        ...current,
                        path: "",
                        ended_at: null,
                        distance_m: 0,
                        point_count: 0,
                    };
                }

                return current;
            });

            if (reset) {
                setLivePath(delta);
                return;
            }

            setLivePath((current) => current + delta);
        });
    }, [parsedId, subscribeTripPath]);

    useEffect(() => {
        if (parsedId === null) {
            return;
        }

        const controller = new AbortController();

        retryTransient(
            () =>
                listVehicleTrips(
                    parsedId,
                    { page: archivePage, limit: archiveLimit },
                    controller.signal,
                ),
            controller.signal,
        )
            .then((response) => {
                setArchiveTrips(response.data);
                setArchivePageCount(response.meta.pageCount);
                setArchiveTotal(response.meta.total);
                setSelectedTripId((current) => {
                    if (
                        current !== null &&
                        response.data.some((row) => row.id === current)
                    ) {
                        return current;
                    }

                    return response.data[0]?.id ?? null;
                });
            })
            .catch((caught: unknown) => {
                if (!isAbortError(caught)) {
                    setArchiveError(
                        caught instanceof Error
                            ? caught.message
                            : "Fahrten konnten nicht geladen werden.",
                    );
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setArchiveLoading(false);
                }
            });

        return () => controller.abort();
    }, [
        parsedId,
        archivePage,
        archiveLimit,
        vehicleStatus,
        archiveRetryKey,
    ]);

    useEffect(() => {
        if (parsedId === null || selectedTripId === null) {
            return;
        }

        const controller = new AbortController();

        retryTransient(
            () =>
                getVehicleTripById(
                    parsedId,
                    selectedTripId,
                    controller.signal,
                ),
            controller.signal,
        )
            .then((response) => {
                tripCache.remember(response.data);
                setSelectedTrip(response.data);
                setLivePath("");
            })
            .catch((caught: unknown) => {
                if (!isAbortError(caught)) {
                    setSelectedTrip(null);
                    setArchiveError(
                        caught instanceof Error
                            ? caught.message
                            : "Fahrt konnte nicht geladen werden.",
                    );
                }
            });

        return () => controller.abort();
    }, [parsedId, selectedTripId, vehicleStatus, tripCache]);

    const selectedFacts =
        archiveTrips.find((row) => row.id === selectedTripId) ??
        selectedTrip;

    // A driving vehicle whose trip is still loading may be about to play its
    // open trip: the map holds its marker back until it knows.
    const tripLoading =
        vehicle?.status === "DRIVING" &&
        archiveError === null &&
        (selectedTripId === null
            ? archiveLoading
            : selectedTrip?.id !== selectedTripId);
    const openPath =
        vehicle?.status === "DRIVING" &&
        selectedTrip?.ended_at === null
            ? selectedTrip.path
            : "";
    const closedPath =
        selectedTrip?.ended_at !== null && selectedTrip?.ended_at !== undefined
            ? selectedTrip.path
            : "";
    const trail = useMemo<MapPoint[]>(() => {
        if (openPath) {
            return decodePolyline(openPath + livePath).map((point) => ({
                latitude: point.lat,
                longitude: point.lng,
            }));
        }

        if (closedPath) {
            return decodePolyline(closedPath).map((point) => ({
                latitude: point.lat,
                longitude: point.lng,
            }));
        }

        return [];
    }, [openPath, livePath, closedPath]);
    const showTrail = trail.length > 0;
    // Length of the drawn line of the running trip, so the km grow with
    // the live path. Only known while that trip is the selected one.
    const openTrailMeters = useMemo(
        () => (openPath ? pathLength(toLatLngs(trail)) : null),
        [openPath, trail],
    );
    // Framed once its line is on the map. While the next picked trip loads,
    // the one framed so far stays, so the panel does not close and reopen.
    const focusedTrip =
        focusTripId !== null &&
        showTrail &&
        selectedTrip !== null &&
        (selectedTrip.id === focusTripId || selectedTrip.id === framedTripId)
            ? selectedTrip
            : null;

    if ((focusedTrip?.id ?? null) !== framedTripId) {
        setFramedTripId(focusedTrip?.id ?? null);
    }

    const focusOpen = focusedTrip !== null && focusedTrip.ended_at === null;
    // A running trip gets new events while it is framed: reload them on
    // each change the stream announces. A closed one only after a resolve.
    const eventsEpoch = focusOpen ? listEpoch : 0;

    useEffect(() => {
        if (
            parsedId === null ||
            focusTripId === null ||
            (eventsEpoch === 0 && eventsReload === 0)
        ) {
            return;
        }

        const controller = new AbortController();

        getVehicleTripById(parsedId, focusTripId, controller.signal)
            .then((response) => {
                tripCache.remember(response.data);
                setFocusEvents({
                    tripId: focusTripId,
                    events: response.data?.events ?? [],
                });
            })
            .catch(() => {
                // The events from the first load stay.
            });

        return () => controller.abort();
    }, [parsedId, focusTripId, eventsEpoch, eventsReload, tripCache]);

    const tripFocus: TripFocusInfo | null = focusedTrip && {
        trip: {
            ...focusedTrip,
            // The running trip's line grows with the stream; its events are
            // placed on what is drawn.
            distance_m:
                focusOpen && openTrailMeters !== null
                    ? Math.max(openTrailMeters, focusedTrip.distance_m)
                    : focusedTrip.distance_m,
        },
        events:
            focusEvents?.tripId === focusedTrip.id
                ? focusEvents.events
                : focusedTrip.events,
        canResolve: canWrite,
        onResolve: async (alertIds) => {
            await resolveAlerts(alertIds);
            tripCache.clear();
            setEventsReload((current) => current + 1);
        },
    };

    usePageTitle(
        vehicle?.license_plate ?? (notFound ? "Fahrzeug nicht gefunden" : null),
    );

    if (isLoading) {
        return (
            <section className={layout.page}>
                <p>Fahrzeug wird geladen…</p>
            </section>
        );
    }

    if (error) {
        return (
            <section className={layout.page}>
                <DetailBackLink fallback="/vehicles" />
                <h1 className={styles.title}>Fahrzeug konnte nicht geladen werden.</h1>
                <RetryMessage message={error} onRetry={retry} />
            </section>
        );
    }

    if (!vehicle || notFound) {
        return (
            <section className={layout.page}>
                <DetailBackLink fallback="/vehicles" />
                <h1 className={styles.title}>
                    Fahrzeug nicht gefunden
                </h1>
                <p>
                    Es gibt kein Fahrzeug mit der Kennung{" "}
                    <code>{id}</code>.
                </p>
            </section>
        );
    }

    const isDriving = vehicle.status === "DRIVING";
    const liveSpeed = speedBand({
        speed: vehicle.speed,
        status: vehicle.status,
        speeding_open: vehicle.speeding_open,
        limit_kmh: vehicle.speed_limit_kmh,
    });
    const position =
        vehicle.recorded_at !== null &&
        vehicle.latitude !== null &&
        vehicle.longitude !== null
            ? { latitude: vehicle.latitude, longitude: vehicle.longitude }
            : null;
    const fuelPercent = Math.min(100, Math.max(0, Math.round(vehicle.fuel_level)));
    const openTrip = isDriving
        ? (archiveTrips.find((row) => row.ended_at === null) ??
          (selectedTrip?.ended_at === null ? selectedTrip : null))
        : null;
    const summary = [
        vehicle.vehicle_type ? VEHICLE_TYPE_LABELS[vehicle.vehicle_type] : null,
        vehicle.driver_name ?? "Kein Fahrer",
        vehicle.depot ? `Stammstandort ${vehicle.depot}` : null,
    ].filter((part): part is string => part !== null);

    const handleSubmit = async (input: VehicleInput) => {
        const errors = await updateVehicle(vehicle.id, input);

        if (!errors) {
            setIsEditingMaster(false);
        }

        return errors;
    };

    const handleDelete = async () => {
        setDeleteError(null);
        setIsDeleting(true);

        try {
            await deleteVehicles([vehicle.id]);
            navigate(from);
        } catch (caught: unknown) {
            setDeleteError(
                caught instanceof Error
                    ? caught.message
                    : "Fahrzeug konnte nicht gelöscht werden.",
            );
        } finally {
            setIsDeleting(false);
        }
    };

    const requestDelete = () => {
        setDeleteError(null);
        setConfirmDelete(true);
    };

    const changeService = async (outOfService: boolean) => {
        setNotice(null);
        setServiceError(null);
        setIsChangingService(true);

        try {
            await setVehicleOutOfService(vehicle.id, outOfService);
            setConfirmOutOfService(false);
            setNotice({
                text: outOfService
                    ? `${vehicle.license_plate} ist außer Dienst.`
                    : `${vehicle.license_plate} ist wieder in Dienst.`,
                tone: "ok",
            });
            refetchLists();
        } catch (caught: unknown) {
            const message =
                caught instanceof Error ? caught.message : "Das hat nicht geklappt.";
            if (outOfService) {
                setServiceError(message);
            } else {
                setNotice({ text: message, tone: "error" });
            }
        } finally {
            setIsChangingService(false);
        }
    };

    return (
        <section className={styles.page}>
            <header className={styles.header}>
                <DetailBackLink fallback="/vehicles" />
                <h1 className={styles.title}>{vehicle.license_plate}</h1>
                <VehicleStatusChip status={vehicle.status} />
                <AvailabilityChip availability={vehicle.availability} />
                {notice ? (
                    <p
                        className={styles.summary}
                        data-tone={notice.tone}
                        role={notice.tone === "error" ? "alert" : "status"}
                    >
                        {notice.text}
                    </p>
                ) : (
                    <p className={styles.summary}>{summary.join(" · ")}</p>
                )}

                {canWrite && (
                    <div className={styles.actions}>
                        <Button
                            variant="secondary"
                            size="toolbar"
                            onClick={() => {
                                setMasterField(undefined);
                                setIsEditingMaster(true);
                            }}
                        >
                            Bearbeiten
                        </Button>
                        <VehicleMoreMenu
                            availability={vehicle.availability}
                            onOutOfService={(outOfService) => {
                                setNotice(null);
                                if (outOfService) {
                                    setServiceError(null);
                                    setConfirmOutOfService(true);
                                } else {
                                    void changeService(false);
                                }
                            }}
                            onDelete={requestDelete}
                        />
                    </div>
                )}
            </header>

            <div className={styles.cockpit}>
                <div className={styles.side}>
                    <section className={styles.panel}>
                        <div className={styles.panelHeader}>
                            <h2 className={styles.panelTitle}>Jetzt</h2>
                            <span
                                className={styles.muted}
                                title={formatTimestamp(vehicle.recorded_at)}
                            >
                                Letzte Meldung{" "}
                                {formatRelativeTimestamp(vehicle.recorded_at)}
                            </span>
                        </div>
                        <dl className={styles.now}>
                            <div>
                                <dt>Tempo</dt>
                                <dd className={styles.nowValue}>
                                    {vehicle.speed === null ? (
                                        "—"
                                    ) : (
                                        <>
                                            <span
                                                className={styles.speed}
                                                data-band={liveSpeed.band}
                                                style={{
                                                    color: SPEED_BAND_COLORS[
                                                        liveSpeed.band
                                                    ],
                                                }}
                                                title={speedBandTitle(liveSpeed)}
                                            >
                                                {vehicle.speed}
                                            </span>{" "}
                                            <span className={styles.unit}>
                                                km/h
                                            </span>
                                        </>
                                    )}
                                </dd>
                                {vehicle.speed_limit_kmh !== null && (
                                    <dd className={styles.muted}>
                                        Limit {vehicle.speed_limit_kmh} km/h
                                    </dd>
                                )}
                            </div>
                            <div>
                                <dt>Tank</dt>
                                <dd className={styles.nowValue}>
                                    {fuelPercent} %
                                </dd>
                                <dd className={styles.fuelBar} aria-hidden="true">
                                    <span
                                        data-low={
                                            isLowFuelLevel(vehicle.fuel_level)
                                                ? "true"
                                                : undefined
                                        }
                                        style={{ width: `${fuelPercent}%` }}
                                    />
                                </dd>
                            </div>
                            <div>
                                <dt>Fahrt</dt>
                                {openTrip ? (
                                    <>
                                        <dd className={styles.nowValue}>
                                            {openTrailMeters === null ? (
                                                "läuft"
                                            ) : (
                                                <>
                                                    {formatKilometerValue(
                                                        openTrailMeters,
                                                    )}{" "}
                                                    <span className={styles.unit}>
                                                        km
                                                    </span>
                                                </>
                                            )}
                                        </dd>
                                        <dd className={styles.muted}>
                                            seit{" "}
                                            {formatTimestamp(openTrip.started_at)}
                                        </dd>
                                    </>
                                ) : (
                                    <>
                                        <dd className={styles.nowValue}>—</dd>
                                        <dd className={styles.muted}>
                                            Keine laufende Fahrt
                                        </dd>
                                    </>
                                )}
                            </div>
                        </dl>
                    </section>

                    <section className={styles.panel}>
                        <VehicleHintsPanel
                            vehicle={vehicle}
                            canWrite={canWrite}
                            onEditMaster={(field) => {
                                setMasterField(field);
                                setIsEditingMaster(true);
                            }}
                        />
                    </section>

                    <section className={`${styles.panel} ${styles.master}`}>
                        <h2 className={styles.panelTitle}>Stammdaten</h2>
                        <dl className={styles.facts}>
                            <div>
                                <dt>VIN</dt>
                                <dd className={styles.vin}>
                                    {vehicle.vin ?? "—"}
                                </dd>
                            </div>
                            <div>
                                <dt>Typ</dt>
                                <dd>
                                    {vehicle.vehicle_type
                                        ? VEHICLE_TYPE_LABELS[
                                              vehicle.vehicle_type
                                          ]
                                        : "—"}
                                </dd>
                            </div>
                            <div>
                                <dt>Kostenstelle</dt>
                                <dd>{vehicle.cost_center ?? "—"}</dd>
                            </div>
                            <div>
                                <dt>HU fällig</dt>
                                <dd>{formatYearMonth(vehicle.hu_due_on)}</dd>
                            </div>
                            <div>
                                <dt>UVV geprüft</dt>
                                <dd>{formatIsoDate(vehicle.uvv_checked_on)}</dd>
                            </div>
                            <div>
                                <dt>UVV fällig am</dt>
                                <dd>{formatIsoDate(vehicle.uvv_due_on)}</dd>
                            </div>
                            <div>
                                <dt>Stammstandort</dt>
                                <dd>
                                    {vehicle.home_site_id && vehicle.depot ? (
                                        <Link
                                            to={`/fleet?depot=${vehicle.home_site_id}`}
                                        >
                                            {vehicle.depot}
                                        </Link>
                                    ) : (
                                        "—"
                                    )}
                                </dd>
                            </div>
                        </dl>
                        <p className={styles.note}>
                            {dueExplanationText(
                                "hu",
                                explainHuMonth(vehicle.hu_due_on),
                            )}{" "}
                            {dueExplanationText(
                                "uvv",
                                explainUvv({
                                    checkedOn: vehicle.uvv_checked_on,
                                    manualDueOn: vehicle.uvv_due_on,
                                    today: berlinTodayIso(),
                                }),
                            )}
                        </p>
                        <VehicleAssignmentPanel
                            vehicle={vehicle}
                            canWrite={canWrite}
                        />
                    </section>
                </div>

                <div className={styles.main}>
                    <section className={styles.panel} aria-label="Werkstatt">
                        <WorkshopPanel
                            vehicle={vehicle}
                            canWrite={canWrite}
                            onNotice={setNotice}
                        />
                    </section>
                    <section className={`${styles.panel} ${styles.mapPanel}`}>
                        <div className={styles.panelHeader}>
                            <h2 className={styles.panelTitle}>Position</h2>
                            {position && (
                                <span className={styles.muted}>
                                    {formatCoordinate(position.latitude, "N", "S")}
                                    {" · "}
                                    {formatCoordinate(position.longitude, "O", "W")}
                                </span>
                            )}
                        </div>

                        {position ? (
                            <div className={styles.mapBody}>
                                <VehicleMap
                                    key={vehicle.id}
                                    latitude={position.latitude}
                                    longitude={position.longitude}
                                    label={vehicle.license_plate}
                                    status={vehicle.status}
                                    recordedAt={vehicle.recorded_at}
                                    trail={showTrail ? trail : undefined}
                                    live={openPath !== ""}
                                    loading={tripLoading}
                                    history={
                                        playbackHistory?.vehicleId === vehicle.id
                                            ? playbackHistory.fixes
                                            : null
                                    }
                                    fill
                                    focus={tripFocus}
                                    onLeaveFocus={() => setFocusTripId(null)}
                                />
                            </div>
                        ) : (
                            <p className={styles.empty}>
                                {isDriving
                                    ? "Noch keine Position gemeldet. Sobald das Fahrzeug Daten sendet, erscheinen hier Karte und Tempo."
                                    : "Dieses Fahrzeug hat noch keine Position gemeldet."}
                            </p>
                        )}
                    </section>

                    <section className={`${styles.panel} ${styles.tripsPanel}`}>
                        <div className={styles.panelHeader}>
                            <h2 className={styles.panelTitle}>
                                Fahrten{" "}
                                {archiveTotal > 0 && (
                                    <span className={styles.count}>
                                        {archiveTotal.toLocaleString("de-DE")}
                                    </span>
                                )}
                            </h2>
                        </div>
                        {/* The line is kept while the trip loads, so the list does not jump. */}
                        <p
                            className={styles.note}
                            aria-hidden={selectedFacts ? undefined : true}
                        >
                            {selectedFacts
                                ? `Auf der Karte: ${describeTrip(selectedFacts)}`
                                : "\u00a0"}
                        </p>
                        {archiveError && (
                            <RetryMessage
                                message={archiveError}
                                onRetry={() =>
                                    setArchiveRetryKey((current) => current + 1)
                                }
                            />
                        )}
                        <VehicleTripArchive
                            trips={archiveTrips}
                            selectedTripId={selectedTripId}
                            onSelectTrip={(tripId) => {
                                setSelectedTripId(tripId);
                                setFocusTripId(tripId);
                                // Loaded before (or ahead, from the row under
                                // the pointer): on the map in this click.
                                const cached = tripCache.get(tripId);

                                if (cached) {
                                    setSelectedTrip(cached);
                                }
                            }}
                            onTripIntent={(row) => {
                                if (row.ended_at !== null) {
                                    tripCache.prefetch(row.id);
                                }
                            }}
                            page={archivePage}
                            pageCount={archivePageCount}
                            limit={archiveLimit}
                            total={archiveTotal}
                            onPageChange={setArchivePage}
                            onLimitChange={(nextLimit) => {
                                setArchiveLimit(nextLimit);
                                setArchivePage(1);
                            }}
                            isLoading={archiveLoading}
                            fill
                        />
                    </section>
                </div>
            </div>

            <Modal
                open={canWrite && isEditingMaster}
                onClose={() => setIsEditingMaster(false)}
                title="Stammdaten"
                guardUnsaved
            >
                <VehicleForm
                    focusField={masterField}
                    initialValue={{
                        license_plate: vehicle.license_plate,
                        fuel_level: vehicle.fuel_level,
                        status: vehicle.status,
                        vin: vehicle.vin,
                        vehicle_type: vehicle.vehicle_type,
                        hu_due_on: vehicle.hu_due_on,
                        uvv_checked_on: vehicle.uvv_checked_on,
                        uvv_due_on: vehicle.uvv_due_on,
                        home_site_id: vehicle.home_site_id,
                        cost_center: vehicle.cost_center,
                    }}
                    isFuelMeasured={vehicle.status === "DRIVING"}
                    submitLabel="Speichern"
                    onSubmit={handleSubmit}
                    onCancel={() => setIsEditingMaster(false)}
                />
            </Modal>

            <ConfirmDialog
                open={canWrite && confirmOutOfService}
                onClose={() => {
                    setConfirmOutOfService(false);
                    setServiceError(null);
                }}
                title="Außer Dienst stellen?"
                confirmLabel="Außer Dienst stellen"
                confirmVariant="primary"
                busyLabel="Wird gespeichert…"
                isBusy={isChangingService}
                onConfirm={() => changeService(true)}
                items={[
                    {
                        key: vehicle.id,
                        name: vehicle.license_plate,
                        detail: vehicle.driver_name
                            ? `aktuell ${vehicle.driver_name}`
                            : vehicleStatusLabel(vehicle.status),
                    },
                ]}
                error={serviceError}
            >
                <p>
                    Das Fahrzeug wird keinem Fahrer mehr zugewiesen, bis du es
                    wieder in Dienst stellst.
                    {vehicle.driver_name
                        ? ` ${vehicle.driver_name} ist danach frei.`
                        : ""}
                </p>
            </ConfirmDialog>

            <ConfirmDialog
                open={canWrite && confirmDelete}
                onClose={() => {
                    setConfirmDelete(false);
                    setDeleteError(null);
                }}
                title="Fahrzeug löschen?"
                confirmLabel="Löschen"
                busyLabel="Wird gelöscht…"
                isBusy={isDeleting}
                onConfirm={handleDelete}
                itemsLabel="Ausgewähltes Fahrzeug"
                items={[
                    {
                        key: vehicle.id,
                        name: vehicle.license_plate,
                        detail: [
                            vehicle.vehicle_type
                                ? VEHICLE_TYPE_LABELS[vehicle.vehicle_type]
                                : null,
                            vehicleStatusLabel(vehicle.status),
                        ]
                            .filter(Boolean)
                            .join(" · "),
                    },
                ]}
                error={deleteError}
            >
                <p>
                    Dieses Fahrzeug wirklich löschen? Das kann nicht
                    rückgängig gemacht werden.
                </p>
            </ConfirmDialog>
        </section>
    );
};
