import { useState } from "react";
import { Link } from "react-router";
import {
    DRIVER_TALK_MIN_OPEN_WARNINGS,
    berlinTodayIso,
    isLicenceExpired,
    type DriverDetail,
    type Vehicle,
} from "@fleet-live/shared";

import { setDriverCurrentVehicle } from "../../api/drivers";
import { formatIsoDate } from "../../utils/dateTime";
import { Button } from "../ui/Button/Button";
import { vehicleDeadlines } from "../vehicles/vehicleDeadlines";
import { DriverTalkDialog } from "./DriverTalkDialog";
import { talkDoneText } from "./driverTalkText";
import { driverHints, type DriverFormField } from "./driverHints";
import detail from "./driverDetail.module.scss";
import styles from "./DriverHintsPanel.module.scss";

interface DriverHintsPanelProps {
    driver: DriverDetail;
    canWrite: boolean;
    /** Months between licence checks (company setting, 0 = off). */
    checkMonths: number;
    /** The vehicle the driver is on, for its deadlines. */
    currentVehicle?: Vehicle | null;
    /** Opens the existing edit form on the field the hint asks for. */
    onEdit: (field: DriverFormField) => void;
    /** After a write here (talk held, vehicle taken off): the page's status line. */
    onChanged?: (message: string) => void;
}

export const DriverHintsPanel = ({
    driver,
    canWrite,
    checkMonths,
    currentVehicle = null,
    onEdit,
    onChanged,
}: DriverHintsPanelProps) => {
    const today = berlinTodayIso();
    const hints = driverHints(driver, checkMonths);
    const openSpeeding = driver.open_warnings;
    const current = driver.current_vehicle;
    const licenceExpired = isLicenceExpired(driver.licence_expires_on, today);
    const expiredVehicleDeadlines = currentVehicle
        ? vehicleDeadlines(currentVehicle, today, 0).filter((deadline) => deadline.state === "overdue")
        : [];
    const [talking, setTalking] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);

    const takeOff = () => {
        if (!current) {
            return;
        }
        setActionError(null);
        void setDriverCurrentVehicle(driver.id, { vehicle_id: null })
            .then(() => onChanged?.(`${driver.name} ist von ${current.license_plate} abgenommen.`))
            .catch((caught: unknown) =>
                setActionError(caught instanceof Error ? caught.message : "Nicht abgenommen."),
            );
    };

    const empty =
        hints.length === 0 &&
        openSpeeding === 0 &&
        driver.workshop_transports.length === 0 &&
        expiredVehicleDeadlines.length === 0;

    return (
        <section className={detail.panel} aria-label="Hinweise">
            <div className={detail.panelHeader}>
                <h2 className={detail.panelTitle}>Hinweise</h2>
            </div>

            {actionError && (
                <p className={styles.error} role="alert">
                    {actionError}
                </p>
            )}

            {empty ? (
                <p className={detail.empty}>Keine offenen Hinweise.</p>
            ) : (
                <ul className={styles.list}>
                    {licenceExpired && current && (
                        <li className={styles.item} data-tone="warning">
                            <span className={styles.tag} data-tone="warning">
                                Führerschein
                            </span>
                            <p className={styles.message}>
                                <b className={styles.strong}>Abgelaufen seit {formatIsoDate(driver.licence_expires_on)}</b>
                                <small>
                                    {current.status === "DRIVING" ? "fährt gerade" : "ist trotzdem eingeteilt auf"}{" "}
                                    <Link to={`/vehicles/${current.id}`}>{current.license_plate}</Link>
                                </small>
                            </p>
                            {canWrite && current.status !== "DRIVING" && (
                                <Button variant="ghost" size="row" onClick={takeOff}>
                                    Abnehmen
                                </Button>
                            )}
                        </li>
                    )}
                    {openSpeeding > 0 && (
                        <li className={styles.item} data-tone="danger">
                            <span className={styles.tag} data-tone="danger">
                                Tempo
                            </span>
                            <p className={styles.message}>
                                {openSpeeding === 1 ? "1 offene Tempo-Warnung" : `${openSpeeding} offene Tempo-Warnungen`}
                                <small>
                                    {openSpeeding >= DRIVER_TALK_MIN_OPEN_WARNINGS
                                        ? `ab ${DRIVER_TALK_MIN_OPEN_WARNINGS} ein Gespräch führen`
                                        : "einzeln unter Warnungen"}
                                </small>
                            </p>
                            {canWrite && (
                                <Button
                                    variant="ghost"
                                    size="row"
                                    onClick={() => setTalking(true)}
                                >
                                    Gespräch geführt
                                </Button>
                            )}
                        </li>
                    )}
                    {expiredVehicleDeadlines.map((deadline) => (
                        <li key={`vehicle-${deadline.reason}`} className={styles.item} data-tone="warning">
                            <span className={styles.tag} data-tone="warning">
                                {deadline.reason}
                            </span>
                            <p className={styles.message}>
                                Fährt{" "}
                                <Link to={`/vehicles/${currentVehicle?.id}`}>{currentVehicle?.license_plate}</Link>{" "}
                                mit abgelaufener {deadline.reason}
                                <small>fällig war {formatIsoDate(deadline.due_on)}</small>
                            </p>
                        </li>
                    ))}
                    {driver.workshop_transports.map((trip) => (
                        <li key={`trip-${trip.visit_id}`} className={styles.item}>
                            <span className={styles.tag}>Werkstatt</span>
                            <p className={styles.message}>
                                Bringt <Link to={`/vehicles/${trip.vehicle_id}`}>{trip.license_plate}</Link> zu {trip.place}
                                <small>
                                    am {formatIsoDate(trip.planned_on)}
                                    {trip.planned_time ? ` um ${trip.planned_time}` : ""}
                                </small>
                            </p>
                        </li>
                    ))}
                    {hints
                        // The expired licence of an assigned driver is said above.
                        .filter((hint) => !(hint.key === "licence_expiry" && licenceExpired && current))
                        .map((hint) => (
                            <li key={hint.key} className={styles.item}>
                                <span className={styles.tag} data-tone={hint.tone}>
                                    {hint.tag}
                                </span>
                                <p className={styles.message}>{hint.text}</p>
                                {canWrite ? (
                                    <Button variant="ghost" size="row" onClick={() => onEdit(hint.field)}>
                                        Eintragen
                                    </Button>
                                ) : hint.fristen ? (
                                    <Link
                                        className={styles.link}
                                        to={`/fristen?state=${hint.fristen.state}&kind=${hint.fristen.kind}&search=${encodeURIComponent(driver.name)}`}
                                    >
                                        Fristen
                                    </Link>
                                ) : null}
                            </li>
                        ))}
                </ul>
            )}

            <DriverTalkDialog
                driver={talking ? driver : null}
                onClose={() => setTalking(false)}
                onDone={(resolved) => {
                    setTalking(false);
                    onChanged?.(talkDoneText(resolved));
                }}
            />
        </section>
    );
};
