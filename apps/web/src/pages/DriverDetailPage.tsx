import { Link, useParams } from "react-router";

import { DriverAssignmentPanel } from "../components/drivers/DriverAssignmentPanel";
import { DetailBackLink } from "../components/navigation/DetailBackLink";
import { useAuth } from "../hooks/useAuth";
import { useDriver } from "../hooks/useDriver";
import layout from "../styles/detailLayout.module.scss";
import styles from "./DriverDetailPage.module.scss";

export const DriverDetailPage = () => {
    const { id } = useParams();
    const { user } = useAuth();
    const canWrite = user?.role === "dispatcher";
    const driverId = Number(id);
    const parsedId = Number.isInteger(driverId) ? driverId : null;
    const { driver, isLoading, error, notFound } = useDriver(parsedId);

    if (isLoading && !driver) {
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
    const openInboxHref = `${inboxHref}&filter=open`;

    return (
        <section className={layout.page}>
            <DetailBackLink fallback="/drivers" />

            <header className={styles.header}>
                <h1 className={styles.title}>{driver.name}</h1>
                <p className={styles.openCount}>
                    {driver.open_warnings > 0 ? (
                        <Link to={openInboxHref}>
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

            <DriverAssignmentPanel driver={driver} canWrite={canWrite} />

            <section className={layout.panel}>
                <h2 className={layout.panelTitle}>Verstöße</h2>
                <p className={layout.note}>
                    Tempo-Überschreitungen am Fahrer. Tank und Funk hängen am
                    Fahrzeug, nicht am Fahrer.
                </p>
                <dl className={layout.facts}>
                    <div>
                        <dt>Gesamt</dt>
                        <dd>{driver.counts.all}</dd>
                    </div>
                    <div>
                        <dt>Offen</dt>
                        <dd>
                            {driver.open_warnings > 0 ? (
                                <Link to={openInboxHref}>
                                    {driver.open_warnings}
                                </Link>
                            ) : (
                                0
                            )}
                        </dd>
                    </div>
                    <div>
                        <dt>Geschwindigkeit</dt>
                        <dd>{driver.counts.SPEEDING}</dd>
                    </div>
                </dl>
                <p className={layout.note}>
                    <Link to={`${inboxHref}&filter=all&type=SPEEDING`}>
                        Alle Tempo-Warnungen
                    </Link>
                </p>
            </section>
        </section>
    );
};
