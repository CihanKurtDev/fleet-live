import { Link, useLocation, useParams } from "react-router";

import { DetailBackLink } from "../components/navigation/DetailBackLink";
import { useDriver } from "../hooks/useDriver";
import { vehicleStatusLabel } from "../components/vehicles/vehicleStatus";
import { alertTypeLabel } from "../components/alerts/alertLabels";
import layout from "../styles/detailLayout.module.scss";
import styles from "./DriverDetailPage.module.scss";

export const DriverDetailPage = () => {
    const { id } = useParams();
    const location = useLocation();
    const driverId = Number(id);
    const parsedId = Number.isInteger(driverId) ? driverId : null;
    const { driver, isLoading, error, notFound } = useDriver(parsedId);

    if (isLoading) {
        return (
            <section className={layout.page}>
                <p>Fahrer wird geladen…</p>
            </section>
        );
    }

    if (error) {
        return (
            <section className={layout.page}>
                <DetailBackLink fallback="/drivers" />
                <h1 className={styles.title}>Fehler</h1>
                <p>{error}</p>
            </section>
        );
    }

    if (!driver || notFound) {
        return (
            <section className={layout.page}>
                <DetailBackLink fallback="/drivers" />
                <h1 className={styles.title}>Fahrer nicht gefunden</h1>
                <p>
                    Es gibt keinen Fahrer mit der Kennung <code>{id}</code>.
                </p>
            </section>
        );
    }

    const inboxHref = `/alerts?driver_id=${driver.id}`;
    const fromHere = `${location.pathname}${location.search}`;

    return (
        <section className={layout.page}>
            <DetailBackLink fallback="/drivers" />

            <header className={styles.header}>
                <h1 className={styles.title}>{driver.name}</h1>
                <p className={styles.openCount}>
                    {driver.open_warnings > 0 ? (
                        <Link to={inboxHref}>
                            {driver.open_warnings}{" "}
                            {driver.open_warnings === 1
                                ? "offene Warnung"
                                : "offene Warnungen"}
                        </Link>
                    ) : (
                        "Keine offenen Warnungen"
                    )}
                </p>
            </header>

            <section className={layout.panel}>
                <h2 className={layout.panelTitle}>Aktuelles Fahrzeug</h2>
                {driver.vehicles.length === 0 ? (
                    <p className={layout.empty}>
                        Diesem Fahrer ist derzeit kein Fahrzeug zugewiesen.
                    </p>
                ) : (
                    <ul className={styles.vehicles}>
                        {driver.vehicles.map((vehicle) => (
                            <li key={vehicle.id}>
                                <Link
                                    to={`/vehicles/${vehicle.id}`}
                                    state={{ from: fromHere }}
                                >
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

            <section className={layout.panel}>
                <h2 className={layout.panelTitle}>Verstöße</h2>
                <p className={layout.note}>
                    Alle Incidents, auch erledigte. Offene Warnungen stehen in
                    der Inbox.
                </p>
                <dl className={layout.facts}>
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
                </dl>
                <p className={layout.note}>
                    <Link to={`${inboxHref}&filter=all`}>
                        Alle Warnungen
                    </Link>
                </p>
            </section>
        </section>
    );
};
