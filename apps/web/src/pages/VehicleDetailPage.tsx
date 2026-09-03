import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import type { Trip, VehicleInput } from "@fleet-live/shared";
import { decodePolyline, speedBand } from "@fleet-live/shared";

import { isAbortError } from "../api/client";
import { retryTransient } from "../api/retryTransient";
import { getVehicleTrip } from "../api/vehicles";
import { VehicleAlertList } from "../components/alerts/VehicleAlertList";
import { DetailBackLink, useDetailBack } from "../components/navigation/DetailBackLink";
import { VehicleAssignmentPanel } from "../components/vehicles/VehicleAssignmentPanel";
import { VehicleForm } from "../components/vehicles/VehicleForm";
import {
    VehicleMap,
    type MapPoint,
} from "../components/vehicles/VehicleMap";
import { vehicleStatusLabel } from "../components/vehicles/vehicleStatus";
import { SPEED_BAND_COLORS, speedBandTitle } from "../components/vehicles/speedBand";
import { Button } from "../components/ui/Button/Button";
import { ConfirmDialog } from "../components/ui/Modal/ConfirmDialog";
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

const describeTrip = (trip: Trip): string => {
    if (trip.ended_at === null) {
        return `Fahrt läuft seit ${formatTimestamp(trip.started_at)}.`;
    }

    return `Letzte Fahrt beendet ${formatTimestamp(trip.ended_at)} · ${formatKilometers(
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
    const [trip, setTrip] = useState<Trip | null>(null);
    const [livePath, setLivePath] = useState("");

    if (parsedId !== tripVehicleId) {
        setTripVehicleId(parsedId);
        setTrip(null);
        setLivePath("");
    }

    useEffect(() => {
        if (parsedId === null) {
            return;
        }

        return subscribeTripPath((vehicleId, delta, reset) => {
            if (vehicleId !== parsedId) {
                return;
            }

            if (reset) {
                setTrip((current) =>
                    current
                        ? {
                              ...current,
                              path: "",
                              ended_at: null,
                              distance_m: 0,
                              point_count: 0,
                          }
                        : current,
                );
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
            () => getVehicleTrip(parsedId, controller.signal),
            controller.signal,
        )
            .then((response) => {
                setTrip(response.data);
                setLivePath("");
            })
            .catch((caught: unknown) => {
                if (!isAbortError(caught)) {
                    setTrip(null);
                }
            });

        return () => controller.abort();
    }, [parsedId]);

    const trail = useMemo<MapPoint[]>(
        () =>
            decodePolyline((trip?.path ?? "") + livePath).map((point) => ({
                latitude: point.lat,
                longitude: point.lng,
            })),
        [trip?.path, livePath],
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
                            trail={trail}
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
                <h2 className={layout.panelTitle}>Letzte Fahrt</h2>
                <p className={layout.note}>
                    {trip
                        ? describeTrip(trip)
                        : "Noch keine Fahrt aufgezeichnet. Die Linie erscheint, sobald das Fahrzeug unterwegs ist."}
                </p>
            </section>

            <VehicleAssignmentPanel
                vehicle={vehicle}
                canWrite={canWrite}
            />

            <section className={layout.panel}>
                <VehicleAlertList
                    vehicleId={vehicle.id}
                    canWrite={canWrite}
                />
            </section>

            <section className={layout.panel}>
                <div className={layout.panelHeader}>
                    <h2 className={layout.panelTitle}>Stammdaten</h2>
                    {canWrite && !isEditingMaster && (
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setIsEditingMaster(true)}
                        >
                            Bearbeiten
                        </Button>
                    )}
                </div>

                {isEditingMaster && canWrite ? (
                    <VehicleForm
                        initialValue={{
                            license_plate: vehicle.license_plate,
                            fuel_level: vehicle.fuel_level,
                            status: vehicle.status,
                        }}
                        isFuelMeasured={isDriving}
                        submitLabel="Speichern"
                        onSubmit={handleSubmit}
                        onCancel={() => setIsEditingMaster(false)}
                    />
                ) : (
                    <dl className={layout.facts}>
                        <div>
                            <dt>Kennzeichen</dt>
                            <dd>{vehicle.license_plate}</dd>
                        </div>
                    </dl>
                )}
            </section>

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
