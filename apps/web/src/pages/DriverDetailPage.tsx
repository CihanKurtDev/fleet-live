import { type MouseEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";

import { useDriver } from "../hooks/useDriver";
import { vehicleStatusLabel } from "../components/vehicles/vehicleStatus";
import { alertTypeLabel } from "../components/alerts/alertLabels";
import styles from "./DriverDetailPage.module.scss";

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

    return { from: "/drivers", fromHistory: false };
};

export const DriverDetailPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { from, fromHistory } = readBackTarget(location.state);
    const driverId = Number(id);
    const parsedId = Number.isInteger(driverId) ? driverId : null;
    const { driver, isLoading, error, notFound } = useDriver(parsedId);

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

    if (isLoading) {
        return (
            <section className={styles.page}>
                <p>Fahrer wird geladen…</p>
            </section>
        );
    }

    if (error) {
        return (
            <section className={styles.page}>
                <h1 className={styles.title}>Fehler</h1>
                <p>{error}</p>
                <Link to="/drivers">Zurück zur Übersicht</Link>
            </section>
        );
    }

    if (!driver || notFound) {
        return (
            <section className={styles.page}>
                <h1 className={styles.title}>Fahrer nicht gefunden</h1>
                <p>
                    Es gibt keinen Fahrer mit der Kennung <code>{id}</code>.
                </p>
                <Link to="/drivers">Zurück zur Übersicht</Link>
            </section>
        );
    }

    return (
        <section className={styles.page}>
            <Link className={styles.back} to={from} onClick={handleBack}>
                Zurück zur Übersicht
            </Link>

            <header className={styles.header}>
                <h1 className={styles.title}>{driver.name}</h1>
            </header>

            <section className={styles.panel}>
                <h2 className={styles.panelTitle}>Verstöße</h2>
                <p className={styles.note}>
                    Alle Incident-Zeilen dieses Fahrers, auch erledigte.
                    Offene Warnungen sind die operative Inbox.
                </p>
                <dl className={styles.facts}>
                    <div>
                        <dt>Gesamt</dt>
                        <dd>{driver.counts.all}</dd>
                    </div>
                    {(["SPEEDING", "LOW_FUEL", "OFFLINE"] as const).map(
                        (type) => (
                            <div key={type}>
                                <dt>{alertTypeLabel(type)}</dt>
                                <dd>{driver.counts[type]}</dd>
                            </div>
                        ),
                    )}
                    <div>
                        <dt>Offene Warnungen</dt>
                        <dd>
                            {driver.open_warnings > 0 ? (
                                <Link to={`/alerts?driver_id=${driver.id}`}>
                                    {driver.open_warnings}
                                </Link>
                            ) : (
                                "0"
                            )}
                        </dd>
                    </div>
                </dl>
                {driver.counts.all > 0 && (
                    <p className={styles.note}>
                        <Link to={`/alerts?driver_id=${driver.id}&filter=all`}>
                            Alle Warnungen dieses Fahrers
                        </Link>
                    </p>
                )}
            </section>

            <section className={styles.panel}>
                <h2 className={styles.panelTitle}>Fahrzeuge</h2>
                {driver.vehicles.length === 0 ? (
                    <p className={styles.empty}>
                        Diesem Fahrer ist derzeit kein Fahrzeug zugewiesen.
                    </p>
                ) : (
                    <ul className={styles.vehicles}>
                        {driver.vehicles.map((vehicle) => (
                            <li key={vehicle.id}>
                                <Link to={`/vehicles/${vehicle.id}`}>
                                    {vehicle.license_plate}
                                </Link>
                                <span>
                                    {vehicleStatusLabel(vehicle.status)}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </section>
    );
};
