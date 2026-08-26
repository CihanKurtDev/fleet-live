import { Link, useNavigate, useParams } from "react-router";
import type { VehicleInput } from "@fleet-live/shared";

import { VehicleForm } from "../components/vehicles/VehicleForm";
import { Button } from "../components/ui/Button/Button";
import { useVehicles } from "../context/vehiclesContext";
import styles from "./VehicleDetailPage.module.scss";

const formatCoordinate = (value: number | null) =>
    value === null ? "—" : value.toFixed(4);

export const VehicleDetailPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { getVehicle, updateVehicle, deleteVehicles } =
        useVehicles();

    const vehicleId = Number(id);
    const vehicle = Number.isInteger(vehicleId)
        ? getVehicle(vehicleId)
        : undefined;

    if (!vehicle) {
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

    const handleDelete = () => {
        deleteVehicles([vehicle.id]);
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

            {/* Platzhalter für die Karte, sobald die Telemetrie-Endpunkte stehen. */}
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
                        Für dieses Fahrzeug liegt noch keine
                        Telemetrie vor.
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
