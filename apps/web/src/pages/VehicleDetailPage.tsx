import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import type { Trip, VehicleInput } from "@fleet-live/shared";
import { decodePolyline, speedBand } from "@fleet-live/shared";

import { isAbortError } from "../api/client";
import { retryTransient } from "../api/retryTransient";
import { getVehicleTrip } from "../api/vehicles";
import { VehicleAlertList } from "../components/alerts/VehicleAlertList";
import { DriverNameLink } from "../components/drivers/DriverNameLink";
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
import { formatTimestamp } from "../utils/dateTime";
import styles from "./VehicleDetailPage.module.scss";

const formatCoordinate = (value: number | null) =>
    value === null ? "—" : value.toFixed(4);

const formatKilometers = (meters: number) =>
    `${(meters / 1_000).toLocaleString("de-DE", {
        maximumFractionDigits: 1,
    })} km`;

const readBackTarget = (
    state: unknown,
): { from: string; fromHistory: boolean } => {
    if (
        typeof state === "object" &&
        state !== null &&
        "from" in state &&
        typeof state.from === "string"
    ) {
        return { from: state.from, fromHistory: true };
    }

    return { from: "/vehicles", fromHistory: false };
};

/**
 * Strecke und Spitzentempo erst zur beendeten Fahrt: die Werte werden einmal
 * geladen und würden während der Fahrt eingefroren stehen bleiben.
 */
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
    const navigate = useNavigate();
    const location = useLocation();
    const { from, fromHistory } = readBackTarget(location.state);
    const backToFleet = from.startsWith("/fleet");
    const { updateVehicle, deleteVehicles, subscribeTripPath } =
        useVehicles();
    const { user } = useAuth();
    const canWrite = user?.role === "dispatcher";

    const vehicleId = Number(id);
    const parsedId = Number.isInteger(vehicleId) ? vehicleId : null;
    const { vehicle, isLoading, error, notFound } = useVehicle(parsedId);
    const [confirmDelete, setConfirmDelete] = useState(false);
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
            <section className={styles.page}>
                <p>Fahrzeug wird geladen…</p>
            </section>
        );
    }

    if (error) {
        return (
            <section className={styles.page}>
                <h1 className={styles.title}>Fehler</h1>
                <p>{error}</p>
                <Link to="/vehicles">Zurück zur Übersicht</Link>
            </section>
        );
    }

    if (!vehicle || notFound) {
        return (
            <section className={styles.page}>
                <h1 className={styles.title}>
                    Fahrzeug nicht gefunden
                </h1>
                <p>
                    Es gibt kein Fahrzeug mit der Kennung{" "}
                    <code>{id}</code>.
                </p>
                <Link to="/vehicles">Zurück zur Übersicht</Link>
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

    const handleSubmit = (input: VehicleInput) =>
        updateVehicle(vehicle.id, input);

    const handleDelete = async () => {
        await deleteVehicles([vehicle.id]);
        navigate(from);
    };

    const requestDelete = () => setConfirmDelete(true);

    const handleBack = (event: MouseEvent<HTMLAnchorElement>) => {
        if (
            !fromHistory ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
        ) {
            return;
        }

        event.preventDefault();
        navigate(-1);
    };

    return (
        <section className={styles.page}>
            <Link className={styles.back} to={from} onClick={handleBack}>
                {backToFleet
                    ? "Zurück zur Karte"
                    : "Zurück zur Übersicht"}
            </Link>

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
                    <DriverNameLink
                        className={styles.driverLink}
                        driverId={vehicle.driver_id}
                        name={vehicle.driver_name}
                    />
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

            <section className={styles.panel}>
                <h2 className={styles.panelTitle}>
                    Letzte Position
                </h2>

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
                        <dl className={styles.facts}>
                            <div>
                                <dt>Breitengrad</dt>
                                <dd>
                                    {formatCoordinate(
                                        position.latitude,
                                    )}
                                </dd>
                            </div>
                            <div>
                                <dt>Längengrad</dt>
                                <dd>
                                    {formatCoordinate(
                                        position.longitude,
                                    )}
                                </dd>
                            </div>
                            <div>
                                <dt>Geschwindigkeit</dt>
                                <dd>
                                    {vehicle.speed === null ? (
                                        "—"
                                    ) : (
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
                                            {vehicle.speed} km/h
                                        </span>
                                    )}
                                </dd>
                            </div>
                            <div>
                                <dt>Letzte Meldung</dt>
                                <dd>
                                    {formatTimestamp(
                                        vehicle.recorded_at,
                                    )}
                                </dd>
                            </div>
                        </dl>
                        <p className={styles.note}>
                            {trip
                                ? describeTrip(trip)
                                : "Noch keine Fahrt aufgezeichnet. Die Linie erscheint, sobald das Fahrzeug unterwegs ist."}
                        </p>
                    </div>
                ) : (
                    <p className={styles.empty}>
                        {isDriving
                            ? "Noch keine Position gemeldet. Sobald das Fahrzeug Daten sendet, erscheinen hier Karte und Tempo."
                            : "Dieses Fahrzeug hat noch keine Position gemeldet."}
                    </p>
                )}
            </section>

            <section className={styles.panel}>
                <VehicleAlertList
                    vehicleId={vehicle.id}
                    canWrite={canWrite}
                />
            </section>

            <section className={styles.panel}>
                <h2 className={styles.panelTitle}>
                    Stammdaten
                </h2>

                <VehicleForm
                    initialValue={{
                        license_plate: vehicle.license_plate,
                        driver_name: vehicle.driver_name,
                        fuel_level: vehicle.fuel_level,
                        status: vehicle.status,
                    }}
                    isFuelMeasured={isDriving}
                    readOnly={!canWrite}
                    submitLabel="Speichern"
                    onSubmit={handleSubmit}
                />
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
