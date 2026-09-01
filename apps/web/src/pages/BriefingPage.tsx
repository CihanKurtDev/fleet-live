import { useState, type MouseEvent } from "react";
import { Link, useLocation } from "react-router";
import type {
    Alert,
    BriefingCounts,
    BriefingData,
    BriefingDriver,
    BriefingOfflineVehicle,
} from "@fleet-live/shared";

import { resolveAlert } from "../api/alerts";
import { ApiError } from "../api/client";
import { rememberVehicle } from "../api/vehicleCache";
import { setTelemetryFocus } from "../api/telemetryFocus";
import { getVehicle } from "../api/vehicles";
import { WarningChip } from "../components/alerts/WarningChip";
import { DriverNameLink } from "../components/drivers/DriverNameLink";
import { Button } from "../components/ui/Button/Button";
import { vehicleStatusLabel } from "../components/vehicles/vehicleStatus";
import { useAuth } from "../hooks/useAuth";
import { useBriefing } from "../hooks/useBriefing";
import { useVehicles } from "../context/vehiclesContext";
import { formatCount } from "../utils/formatCount";
import {
    formatRelativeTimestamp,
    formatSinceTimestamp,
} from "../utils/dateTime";
import styles from "./BriefingPage.module.scss";

const briefingDateLabel = (now = new Date()) =>
    new Intl.DateTimeFormat("de-DE", {
        weekday: "long",
        day: "numeric",
        month: "long",
    }).format(now);

const briefingNeed = (open: number) => {
    if (open === 0) {
        return "Keine offenen Warnungen.";
    }

    if (open === 1) {
        return "1 offene Warnung braucht dich.";
    }

    return `${formatCount(open)} offene Warnungen brauchen dich.`;
};

const prefetchVehicle = (vehicleId: number) => {
    setTelemetryFocus("detail", [vehicleId]);
    void getVehicle(vehicleId)
        .then(rememberVehicle)
        .catch(() => undefined);
};

const Kpis = ({ counts }: { counts: BriefingCounts }) => {
    const tiles: Array<{
        key: keyof BriefingCounts;
        label: string;
        hint?: string;
        accent?: boolean;
        to?: string;
    }> = [
        {
            key: "open",
            label: "Offen",
            hint: "Inbox",
            accent: true,
            to: "/alerts",
        },
        {
            key: "offline",
            label: "Kein Signal",
            hint: "sofort",
            to: "/vehicles?filter=offline",
        },
        {
            key: "driving",
            label: "Auf Fahrt",
            to: "/vehicles?filter=driving",
        },
        { key: "idle", label: "Standby" },
        {
            key: "low_fuel",
            label: "Wenig Tank",
            to: "/alerts?type=LOW_FUEL",
        },
    ];

    return (
        <div className={styles.kpis}>
            {tiles.map((tile) => {
                const body = (
                    <>
                        <span className={styles.kpiLabel}>{tile.label}</span>
                        <span
                            className={styles.kpiValue}
                            data-accent={tile.accent ? "true" : undefined}
                        >
                            {formatCount(counts[tile.key])}
                        </span>
                        {tile.hint ? (
                            <span className={styles.kpiHint}>{tile.hint}</span>
                        ) : null}
                    </>
                );

                if (tile.to) {
                    return (
                        <Link
                            key={tile.key}
                            className={styles.kpi}
                            to={tile.to}
                        >
                            {body}
                        </Link>
                    );
                }

                return (
                    <div key={tile.key} className={styles.kpi}>
                        {body}
                    </div>
                );
            })}
        </div>
    );
};

const WorkList = ({
    alerts,
    canWrite,
}: {
    alerts: Alert[];
    canWrite: boolean;
}) => {
    const { refetchLists } = useVehicles();
    const location = useLocation();
    const from = `${location.pathname}${location.search}`;
    const [resolvingId, setResolvingId] = useState<number | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);

    const handleResolve = (
        event: MouseEvent<HTMLButtonElement>,
        alert: Alert,
    ) => {
        event.stopPropagation();
        void (async () => {
            setResolvingId(alert.id);
            setActionError(null);
            try {
                await resolveAlert(alert.id);
                refetchLists();
            } catch (caught) {
                setActionError(
                    caught instanceof ApiError
                        ? caught.message
                        : "Warnung konnte nicht erledigt werden.",
                );
            } finally {
                setResolvingId(null);
            }
        })();
    };

    return (
        <section className={styles.card}>
            <h2 className={styles.cardTitle}>Jetzt erledigen</h2>
            {alerts.length === 0 ? (
                <p className={styles.empty}>Keine offenen Warnungen.</p>
            ) : (
                alerts.map((alert) => (
                    <div key={alert.id} className={styles.workRow}>
                        <WarningChip type={alert.type} />
                        <Link
                            className={styles.plate}
                            to={`/vehicles/${alert.vehicle_id}`}
                            state={{ from }}
                            onClick={() => prefetchVehicle(alert.vehicle_id)}
                        >
                            {alert.license_plate}
                        </Link>
                        <DriverNameLink
                            driverId={alert.driver_id}
                            name={alert.driver_name}
                        />
                        <span className={styles.time}>
                            {formatRelativeTimestamp(alert.created_at)}
                        </span>
                        {canWrite ? (
                            <Button
                                variant="secondary"
                                size="sm"
                                disabled={resolvingId === alert.id}
                                onClick={(event) => handleResolve(event, alert)}
                            >
                                Erledigen
                            </Button>
                        ) : (
                            <span className={styles.status}>Offen</span>
                        )}
                    </div>
                ))
            )}
            {actionError ? <p className={styles.error}>{actionError}</p> : null}
            <p className={styles.footer}>
                <Link className={styles.footerLink} to="/alerts">
                    Alle offenen Warnungen
                </Link>
            </p>
        </section>
    );
};

const OfflineList = ({
    vehicles,
}: {
    vehicles: BriefingOfflineVehicle[];
}) => {
    const location = useLocation();
    const from = `${location.pathname}${location.search}`;

    return (
        <section className={styles.card}>
            <h2 className={styles.cardTitle}>Kein Signal</h2>
            {vehicles.length === 0 ? (
                <p className={styles.empty}>Alle Fahrzeuge senden.</p>
            ) : (
                vehicles.map((vehicle) => (
                    <div key={vehicle.id} className={styles.sideRow}>
                        <Link
                            className={styles.plate}
                            to={`/vehicles/${vehicle.id}`}
                            state={{ from }}
                            onClick={() => prefetchVehicle(vehicle.id)}
                        >
                            {vehicle.license_plate}
                        </Link>
                        <span className={styles.status}>
                            {vehicleStatusLabel("OFFLINE")}
                        </span>
                        <span className={styles.time}>
                            {formatSinceTimestamp(vehicle.recorded_at)}
                        </span>
                    </div>
                ))
            )}
        </section>
    );
};

const DriverList = ({ drivers }: { drivers: BriefingDriver[] }) => (
    <section className={styles.card}>
        <h2 className={styles.cardTitle}>Auffällige Fahrer</h2>
        {drivers.length === 0 ? (
            <p className={styles.empty}>Keine offenen Warnungen bei Fahrern.</p>
        ) : (
            drivers.map((driver) => (
                <div key={driver.id} className={styles.driverRow}>
                    <DriverNameLink driverId={driver.id} name={driver.name} />
                    <span className={styles.openCount}>
                        {formatCount(driver.open_warnings)} offen
                    </span>
                </div>
            ))
        )}
    </section>
);

const BriefingBody = ({
    data,
    canWrite,
}: {
    data: BriefingData;
    canWrite: boolean;
}) => (
    <>
        <header className={styles.header}>
            <h1 className={styles.title}>Schicht</h1>
            <p className={styles.subtitle}>
                {briefingDateLabel()} · {briefingNeed(data.counts.open)}
            </p>
        </header>
        <Kpis counts={data.counts} />
        <div className={styles.columns}>
            <WorkList alerts={data.open_alerts} canWrite={canWrite} />
            <div className={styles.side}>
                <OfflineList vehicles={data.offline_vehicles} />
                <DriverList drivers={data.drivers} />
            </div>
        </div>
    </>
);

export const BriefingPage = () => {
    const { user } = useAuth();
    const { data, isLoading, error } = useBriefing();
    const canWrite = user?.role === "dispatcher";

    if (isLoading) {
        return (
            <section className={styles.page}>
                <header className={styles.header}>
                    <h1 className={styles.title}>Schicht</h1>
                    <p className={styles.statusLine}>Laden…</p>
                </header>
            </section>
        );
    }

    if (error || !data) {
        return (
            <section className={styles.page}>
                <header className={styles.header}>
                    <h1 className={styles.title}>Schicht</h1>
                    <p className={styles.error}>
                        {error ?? "Schicht konnte nicht geladen werden."}
                    </p>
                </header>
            </section>
        );
    }

    return (
        <section className={styles.page}>
            <BriefingBody data={data} canWrite={canWrite} />
        </section>
    );
};
