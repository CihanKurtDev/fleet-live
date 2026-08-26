import { Link, useNavigate, useParams } from "react-router";
import type { VehicleInput } from "@fleet-live/shared";

import { VehicleForm } from "../components/vehicles/VehicleForm";
import { Button } from "../components/ui/Button/Button";
import { useVehicles } from "../context/vehiclesContext";
import { useVehicle } from "../hooks/useVehicle";
import styles from "./VehicleDetailPage.module.scss";

const formatCoordinate = (value: number | null) =>
    value === null ? "—" : value.toFixed(4);

export const VehicleDetailPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { updateVehicle, deleteVehicles } = useVehicles();

    const vehicleId = Number(id);
    const parsedId = Number.isInteger(vehicleId) ? vehicleId : null;
    const { vehicle, isLoading, error, notFound } = useVehicle(parsedId);

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

    const handleSubmit = (input: VehicleInput) =>
        updateVehicle(vehicle.id, input);

    const handleDelete = async () => {
        await deleteVehicles([vehicle.id]);
        navigate("/vehicles");
    };

    return (
        <section className={styles.page}>
            <Link className={styles.back} to="/vehicles">
                Zurück zur Übersicht
            </Link>

            <header className={styles.header}>
                <h1 className={styles.title}>
                    {vehicle.license_plate}
                </h1>

                <Button
                    variant="danger"
                    size="sm"
                    onClick={handleDelete}
                >
                    Fahrzeug löschen
                </Button>
            </header>

            <section className={styles.panel}>
                <h2 className={styles.panelTitle}>
                    Letzte Position
                </h2>

                {vehicle.recorded_at ? (
                    <dl className={styles.facts}>
                        <div>
                            <dt>Breite</dt>
                            <dd>
                                {formatCoordinate(
                                    vehicle.latitude,
                                )}
                            </dd>
                        </div>
                        <div>
                            <dt>Länge</dt>
                            <dd>
                                {formatCoordinate(
                                    vehicle.longitude,
                                )}
                            </dd>
                        </div>
                        <div>
                            <dt>Geschwindigkeit</dt>
                            <dd>
                                {vehicle.speed === null
                                    ? "—"
                                    : `${vehicle.speed} km/h`}
                            </dd>
                        </div>
                        <div>
                            <dt>Gemeldet</dt>
                            <dd>{vehicle.recorded_at}</dd>
                        </div>
                    </dl>
                ) : (
                    <p className={styles.empty}>
                        {vehicle.status === "DRIVING"
                            ? "Noch kein Datenpunkt — sobald der Simulator dieses Fahrzeug in einer Scheibe hat, erscheinen hier Position und Tempo."
                            : `Keine Telemetrie. Der Simulator sendet nur an Fahrzeuge mit Status DRIVING (aktuell: ${vehicle.status}).`}
                    </p>
                )}
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
                    submitLabel="Speichern"
                    onSubmit={handleSubmit}
                />
            </section>
        </section>
    );
};
