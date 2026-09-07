import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import type { Trip, TripListItem, VehicleInput } from "@fleet-live/shared";
import { decodePolyline, speedBand } from "@fleet-live/shared";

import { isAbortError } from "../api/client";
import { retryTransient } from "../api/retryTransient";
import { getVehicleTripById, listVehicleTrips } from "../api/vehicles";
import { VehicleHintsPanel } from "../components/alerts/VehicleHintsPanel";
import { DetailBackLink, useDetailBack } from "../components/navigation/DetailBackLink";
import { VehicleAssignmentPanel } from "../components/vehicles/VehicleAssignmentPanel";
import { VehicleForm } from "../components/vehicles/VehicleForm";
import {
    VehicleMap,
    type MapPoint,
} from "../components/vehicles/VehicleMap";
import { VehicleTripArchive } from "../components/vehicles/VehicleTripArchive";
import { vehicleStatusLabel } from "../components/vehicles/vehicleStatus";
import { SPEED_BAND_COLORS, speedBandTitle } from "../components/vehicles/speedBand";
import { Button } from "../components/ui/Button/Button";
import { ConfirmDialog } from "../components/ui/Modal/ConfirmDialog";
import { Modal } from "../components/ui/Modal/Modal";
import { useVehicles } from "../context/vehiclesContext";
import { useAuth } from "../hooks/useAuth";
import { useVehicle } from "../hooks/useVehicle";
import { formatRelativeTimestamp, formatTimestamp } from "../utils/dateTime";
import layout from "../styles/detailLayout.module.scss";
import styles from "./VehicleDetailPage.module.scss";

const formatCoordinate = (value: number | null) =>
    value === null ? "—" : value.toFixed(4);

const formatKilometers = (meters: number) =>
    `${(meters / 1_000).toLocaleString("de-DE", {
        maximumFractionDigits: 1,
    })} km`;

const describeTrip = (trip: TripListItem): string => {
    if (trip.ended_at === null) {
        return `Fahrt läuft seit ${formatTimestamp(trip.started_at)}.`;
    }

    return `${formatTimestamp(trip.started_at)} – ${formatTimestamp(trip.ended_at)} · ${formatKilometers(
        trip.distance_m,
    )} · Spitze ${Math.round(trip.max_speed)} km/h`;
};

export const VehicleDetailPage = () => {
    const { id } = useParams();
    const { from, navigate } = useDetailBack("/vehicles");
    const { updateVehicle, deleteVehicles, subscribeTripPath } =
        useVehicles();
    const { user } = useAuth();
    const canWrite = user?.role === "dispatcher";

    const vehicleId = Number(id);
    const parsedId = Number.isInteger(vehicleId) ? vehicleId : null;
    const { vehicle, isLoading, error, notFound } = useVehicle(parsedId);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [isEditingMaster, setIsEditingMaster] = useState(false);
    const [tripVehicleId, setTripVehicleId] = useState(parsedId);
    const [livePath, setLivePath] = useState("");
    const [archiveTrips, setArchiveTrips] = useState<TripListItem[]>([]);
    const [archivePage, setArchivePage] = useState(1);
    const [archiveLimit, setArchiveLimit] = useState(10);
    const [archivePageCount, setArchivePageCount] = useState(1);
    const [archiveTotal, setArchiveTotal] = useState(0);
    const [archiveLoading, setArchiveLoading] = useState(false);
    const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
    const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);

    if (parsedId !== tripVehicleId) {
        setTripVehicleId(parsedId);
        setLivePath("");
        setArchiveTrips([]);
        setArchivePage(1);
        setArchiveLimit(10);
        setSelectedTripId(null);
        setSelectedTrip(null);
    }

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
        setArchiveLoading(true);

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
                    setArchiveTrips([]);
                    setArchiveTotal(0);
                    setSelectedTripId(null);
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setArchiveLoading(false);
                }
            });

        return () => controller.abort();
    }, [parsedId, archivePage, archiveLimit, vehicle?.status]);

    useEffect(() => {
        if (parsedId === null || selectedTripId === null) {
            setSelectedTrip(null);
            return;
        }

        if (vehicle && vehicle.status !== "DRIVING") {
            setLivePath("");
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
                setSelectedTrip(response.data);
                setLivePath("");
            })
            .catch((caught: unknown) => {
                if (!isAbortError(caught)) {
                    setSelectedTrip(null);
                }
            });

        return () => controller.abort();
    }, [parsedId, selectedTripId, vehicle?.status]);

    const selectedFacts =
        archiveTrips.find((row) => row.id === selectedTripId) ??
        selectedTrip;

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
                <h1 className={styles.title}>Fehler</h1>
                <p>{error}</p>
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

    const handleSubmit = async (input: VehicleInput) => {
        const errors = await updateVehicle(vehicle.id, input);

        if (!errors) {
            setIsEditingMaster(false);
        }

        return errors;
    };

    const handleDelete = async () => {
        await deleteVehicles([vehicle.id]);
        navigate(from);
    };

    const requestDelete = () => setConfirmDelete(true);

    return (
        <section className={layout.page}>
            <DetailBackLink fallback="/vehicles" />

            <header className={styles.header}>
                <div className={styles.heading}>
                    <h1 className={styles.title}>
                        {vehicle.license_plate}
                    </h1>
                    <span
                        className={styles.badge}
                        data-status={vehicle.status}
                    >
                        {vehicleStatusLabel(vehicle.status)}
                    </span>
                </div>

                {canWrite && (
                    <div className={styles.actions}>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setIsEditingMaster(true)}
                        >
                            Bearbeiten
                        </Button>
                        <Button
                            variant="danger"
                            size="sm"
                            onClick={requestDelete}
                        >
                            Fahrzeug löschen
                        </Button>
                    </div>
                )}
            </header>

            <section className={layout.now}>
                <h2 className={layout.nowTitle}>Jetzt</h2>
                <dl className={layout.facts}>
                    <div>
                        <dt>Tempo</dt>
                        <dd>
                            {vehicle.speed === null ? (
                                "—"
                            ) : (
                                <span
                                    className={styles.speed}
                                    data-band={liveSpeed.band}
                                    style={{
                                        color: SPEED_BAND_COLORS[liveSpeed.band],
                                    }}
                                    title={speedBandTitle(liveSpeed)}
                                >
                                    {vehicle.speed} km/h
                                </span>
                            )}
                        </dd>
                    </div>
                    <div>
                        <dt>Tank</dt>
                        <dd>{Math.round(vehicle.fuel_level)} %</dd>
                    </div>
                    <div>
                        <dt>Letzte Meldung</dt>
                        <dd title={formatTimestamp(vehicle.recorded_at)}>
                            {formatRelativeTimestamp(vehicle.recorded_at)}
                        </dd>
                    </div>
                </dl>
            </section>

            <section className={layout.panel}>
                <h2 className={layout.panelTitle}>Standort</h2>

                {position ? (
                    <div className={styles.positionBody}>
                        <VehicleMap
                            key={vehicle.id}
                            latitude={position.latitude}
                            longitude={position.longitude}
                            label={vehicle.license_plate}
                            status={vehicle.status}
                            trail={showTrail ? trail : undefined}
                        />
                        <details className={styles.coords}>
                            <summary>Koordinaten</summary>
                            <dl className={layout.facts}>
                                <div>
                                    <dt>Breitengrad</dt>
                                    <dd>
                                        {formatCoordinate(position.latitude)}
                                    </dd>
                                </div>
                                <div>
                                    <dt>Längengrad</dt>
                                    <dd>
                                        {formatCoordinate(position.longitude)}
                                    </dd>
                                </div>
                            </dl>
                        </details>
                    </div>
                ) : (
                    <p className={layout.empty}>
                        {isDriving
                            ? "Noch keine Position gemeldet. Sobald das Fahrzeug Daten sendet, erscheinen hier Karte und Tempo."
                            : "Dieses Fahrzeug hat noch keine Position gemeldet."}
                    </p>
                )}
            </section>

            <section className={layout.panel}>
                <h2 className={layout.panelTitle}>Fahrten</h2>
                {selectedFacts && (
                    <p className={layout.note}>{describeTrip(selectedFacts)}</p>
                )}
                <VehicleTripArchive
                    trips={archiveTrips}
                    selectedTripId={selectedTripId}
                    onSelectTrip={setSelectedTripId}
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
                />
            </section>

            <VehicleAssignmentPanel
                vehicle={vehicle}
                canWrite={canWrite}
            />

            <section className={layout.panel}>
                <VehicleHintsPanel
                    vehicle={vehicle}
                    canWrite={canWrite}
                />
            </section>

            <Modal
                open={canWrite && isEditingMaster}
                onClose={() => setIsEditingMaster(false)}
                title="Kennzeichen"
            >
                <VehicleForm
                    initialValue={{
                        license_plate: vehicle.license_plate,
                        fuel_level: vehicle.fuel_level,
                        status: vehicle.status,
                    }}
                    isFuelMeasured={false}
                    submitLabel="Speichern"
                    onSubmit={handleSubmit}
                    onCancel={() => setIsEditingMaster(false)}
                />
            </Modal>

            <ConfirmDialog
                open={canWrite && confirmDelete}
                onClose={() => setConfirmDelete(false)}
                title="Fahrzeug löschen?"
                confirmLabel="Löschen"
                onConfirm={handleDelete}
            >
                <p>
                    „{vehicle.license_plate}“ wirklich löschen? Das
                    kann nicht rückgängig gemacht werden.
                </p>
            </ConfirmDialog>
        </section>
    );
};
