import {
    berlinTodayIso,
    dueExplanationText,
    dueRule,
    explainLicenceCheck,
    explainLicenceExpiry,
} from "@fleet-live/shared";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { DriverAssignmentPanel } from "../components/drivers/DriverAssignmentPanel";
import { DriverEditForm } from "../components/drivers/DriverEditForm";
import { DriverWarningCell } from "../components/drivers/DriverTableCells";
import { DetailBackLink } from "../components/navigation/DetailBackLink";
import { RetryMessage } from "../components/ui/RetryMessage";
import { Button } from "../components/ui/Button/Button";
import { Modal } from "../components/ui/Modal/Modal";
import { useVehicles } from "../context/vehiclesContext";
import { useAuth } from "../hooks/useAuth";
import { useDueSettings } from "../hooks/useDueSettings";
import { useDriver } from "../hooks/useDriver";
import { formatIsoDate } from "../utils/dateTime";
import layout from "../styles/detailLayout.module.scss";
import band from "../styles/pageBand.module.scss";
import styles from "./DriverDetailPage.module.scss";

export const DriverDetailPage = () => {
    const { id } = useParams();
    const { user } = useAuth();
    const { settings: dueSettings } = useDueSettings();
    const { refetchLists } = useVehicles();
    const canWrite = user?.role === "dispatcher";
    const driverId = Number(id);
    const parsedId = Number.isInteger(driverId) ? driverId : null;
    const { driver, isLoading, error, retry, notFound } =
        useDriver(parsedId);
    const [isEditing, setIsEditing] = useState(false);

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
                <RetryMessage message={error} onRetry={retry} />
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
            <header className={`${band.band} ${band.bleedDetail}`}>
                <DetailBackLink fallback="/drivers" />
                <div className={styles.header}>
                <div className={styles.identity}>
                    <h1 className={styles.title}>{driver.name}</h1>
                    <div className={styles.statusRow}>
                        <DriverWarningCell driver={driver} />
                        {driver.open_warnings > 0 ? (
                            <Link className={styles.inboxLink} to={openInboxHref}>
                                Inbox öffnen
                            </Link>
                        ) : null}
                    </div>
                    <p className={styles.openCount}>
                        Telefon: {driver.phone ?? "—"}
                    </p>
                </div>
                {canWrite && (
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setIsEditing(true)}
                    >
                        Bearbeiten
                    </Button>
                )}
                </div>
            </header>

            <DriverAssignmentPanel driver={driver} canWrite={canWrite} />

            <section className={layout.panel}>
                <h2 className={layout.panelTitle}>Führerschein</h2>
                <dl className={layout.facts}>
                    <div>
                        <dt>Gültig bis</dt>
                        <dd>{formatIsoDate(driver.licence_expires_on)}</dd>
                    </div>
                    <div>
                        <dt>Kontrolliert am</dt>
                        <dd>{formatIsoDate(driver.licence_checked_on)}</dd>
                    </div>
                </dl>
                <p className={layout.note}>
                    Frühester Klassenablauf, zum Beispiel C/CE.{" "}
                    {dueExplanationText(
                        "licence_expiry",
                        explainLicenceExpiry(driver.licence_expires_on),
                    )}{" "}
                    {dueExplanationText(
                        "licence_check",
                        explainLicenceCheck({
                            checkedOn: driver.licence_checked_on,
                            today: berlinTodayIso(),
                            intervalMonths:
                                dueSettings?.check_months ??
                                dueRule("licence_check").interval_months ??
                                6,
                        }),
                    )}
                </p>
            </section>

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

            <Modal
                open={canWrite && isEditing}
                onClose={() => setIsEditing(false)}
                title="Fahrer bearbeiten"
            >
                <DriverEditForm
                    driver={driver}
                    onCancel={() => setIsEditing(false)}
                    onSaved={() => {
                        refetchLists();
                        setIsEditing(false);
                    }}
                />
            </Modal>
        </section>
    );
};
