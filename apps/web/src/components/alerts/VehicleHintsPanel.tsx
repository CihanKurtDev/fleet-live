import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
    berlinTodayIso,
    isLowFuelLevel,
    isSpeedingAlertDetails,
    parseAlertListQuery,
    type Alert,
    type Damage,
    type Vehicle,
    type WorkshopReason,
} from "@fleet-live/shared";

import { listAlerts } from "../../api/alerts";
import { getDriver } from "../../api/drivers";
import { useVehicles } from "../../context/vehiclesContext";
import { useDueSettings } from "../../hooks/useDueSettings";
import { formatIsoDate, formatShortStamp, formatSince } from "../../utils/dateTime";
import { Button } from "../ui/Button/Button";
import { InspectionPlaque } from "../vehicles/InspectionPlaque";
import type { VehicleFormField } from "../vehicles/VehicleForm";
import { expiredSinceText, vehicleDeadlines, type VehicleDeadline } from "../vehicles/vehicleDeadlines";
import { WarningChip } from "./WarningChip";
import styles from "./VehicleHintsPanel.module.scss";

interface VehicleHintsPanelProps {
    vehicle: Vehicle;
    canWrite: boolean;
    /** Opens the master-data form on the field that takes the missing date. */
    onEditMaster?: (field: VehicleFormField) => void;
    /** The vehicle's damages; open ones are hints. */
    damages?: Damage[];
    onEditDamage?: (damage: Damage) => void;
    /** Plans a workshop stay for an overdue HU/UVV or an open damage. */
    onPlanWorkshop?: (plan: { reason: WorkshopReason; damageId?: number }) => void;
    /** Adds an overdue HU/UVV to the stay that is planned already. */
    onAddToStay?: (reason: "HU" | "UVV") => void;
    /** „Schaden melden“ in the head of the panel, where damages are listed. */
    onReportDamage?: () => void;
    /** Frames the trip of an open speeding warning on the map. */
    onShowTrip?: (tripId: number) => void;
}

/** „Reifen geplatzt · nicht fahrbereit · 28.10.2026 07:42 · Sam Nowak · 2 Fotos“. */
const damageText = (damage: Damage) =>
    [
        damage.description,
        damage.drivable ? null : "nicht fahrbereit",
        `${formatIsoDate(damage.occurred_on)}${damage.occurred_time ? ` ${damage.occurred_time}` : ""}`,
        damage.driver_name,
        damage.photo_ids.length === 0
            ? null
            : damage.photo_ids.length === 1
              ? "1 Foto"
              : `${damage.photo_ids.length} Fotos`,
    ]
        .filter(Boolean)
        .join(" · ");

/** A damage in an open workshop stay: the stay takes care of it. */
const damageStay = (damage: Damage) =>
    damage.workshop_state === "IN_WORKSHOP"
        ? "In der Werkstatt"
        : damage.workshop_state === "PLANNED" && damage.workshop_planned_on
          ? `Termin am ${formatIsoDate(damage.workshop_planned_on)}`
          : null;

/** „Plakette 02/2026“ for an HU, „fällig war 21.09.2026“ for a UVV. */
const deadlineDate = (deadline: VehicleDeadline) =>
    deadline.due_on === null
        ? ""
        : deadline.reason === "HU"
          ? `Plakette ${deadline.due_on.slice(5, 7)}/${deadline.due_on.slice(0, 4)}`
          : `fällig war ${formatIsoDate(deadline.due_on)}`;

export const VehicleHintsPanel = ({
    vehicle,
    canWrite,
    onEditMaster,
    damages = [],
    onEditDamage,
    onPlanWorkshop,
    onAddToStay,
    onReportDamage,
    onShowTrip,
}: VehicleHintsPanelProps) => {
    const { listEpoch } = useVehicles();
    const { settings: dueSettings } = useDueSettings();
    const today = berlinTodayIso();
    // A second open stay is not possible: with one, the hints name it.
    const canPlan = canWrite && onPlanWorkshop !== undefined && vehicle.workshop === null;
    const openDamages = damages.filter((damage) => damage.state === "OPEN");
    const tankLow = isLowFuelLevel(vehicle.fuel_level);
    // The warning closes itself when the vehicle reports again, so it is
    // there exactly while the vehicle has no signal.
    const noSignal = vehicle.status === "OFFLINE" || vehicle.open_alert_types.includes("OFFLINE");
    const hasSpeeding = vehicle.open_alert_types.includes("SPEEDING");
    // Expired and missing dates are hints here; „bald“ stays on /fristen.
    const deadlines = vehicleDeadlines(vehicle, today, dueSettings?.lead_days ?? 30).filter(
        (deadline) => deadline.state === "overdue" || deadline.state === "missing",
    );

    // The newest open speeding warning, and the open signal warning with
    // whom to call: what the vehicle list counts, said here too.
    const [speeding, setSpeeding] = useState<{ alert: Alert; total: number } | null>(null);
    const [offline, setOffline] = useState<{ since: string | null; phone: string | null } | null>(null);
    const driverId = vehicle.current_driver_id;

    useEffect(() => {
        if (!hasSpeeding) {
            return;
        }
        const controller = new AbortController();
        listAlerts(
            parseAlertListQuery({ vehicle_id: vehicle.id, type: "SPEEDING", filter: "open", sort: "created_at", dir: "desc", limit: 1 }),
            controller.signal,
        )
            .then((response) =>
                setSpeeding(response.data[0] ? { alert: response.data[0], total: response.meta.total } : null),
            )
            .catch(() => setSpeeding(null));
        return () => controller.abort();
    }, [vehicle.id, hasSpeeding, listEpoch]);

    useEffect(() => {
        if (!noSignal) {
            return;
        }
        const controller = new AbortController();
        Promise.all([
            listAlerts(
                parseAlertListQuery({ vehicle_id: vehicle.id, type: "OFFLINE", filter: "open", limit: 1 }),
                controller.signal,
            ),
            driverId === null ? Promise.resolve(null) : getDriver(driverId, controller.signal),
        ])
            .then(([alerts, driver]) =>
                setOffline({ since: alerts.data[0]?.created_at ?? null, phone: driver?.phone ?? null }),
            )
            .catch(() => setOffline(null));
        return () => controller.abort();
    }, [vehicle.id, noSignal, driverId, listEpoch]);

    const speedingDetails = speeding && isSpeedingAlertDetails(speeding.alert.details) ? speeding.alert.details : null;
    const empty = !tankLow && !noSignal && !hasSpeeding && deadlines.length === 0 && openDamages.length === 0;

    const deadlineAction = (deadline: VehicleDeadline) => {
        const stay = vehicle.workshop;
        if (stay?.reasons.includes(deadline.reason)) {
            return (
                <span className={styles.stay}>
                    {stay.state === "IN_WORKSHOP" ? "In der Werkstatt" : `Termin am ${formatIsoDate(stay.planned_on)}`}
                </span>
            );
        }
        if (!canWrite) {
            return (
                <Link
                    className={styles.inboxLink}
                    to={`/fristen?state=${deadline.state}&kind=${deadline.reason.toLowerCase()}&search=${encodeURIComponent(vehicle.license_plate)}`}
                >
                    Fristen
                </Link>
            );
        }
        if (deadline.state === "overdue" && stay && onAddToStay) {
            return (
                <Button variant="ghost" size="row" onClick={() => onAddToStay(deadline.reason)}>
                    Zum Termin dazu
                </Button>
            );
        }
        if (deadline.state === "overdue" && canPlan) {
            return (
                <Button variant="ghost" size="row" onClick={() => onPlanWorkshop?.({ reason: deadline.reason })}>
                    Termin planen
                </Button>
            );
        }
        return onEditMaster ? (
            <Button
                variant="ghost"
                size="row"
                onClick={() => onEditMaster(deadline.reason === "HU" ? "hu" : "uvv-checked")}
            >
                Eintragen
            </Button>
        ) : null;
    };

    return (
        <>
            <div className={styles.header}>
                <h2 className={styles.panelTitle}>Hinweise</h2>
                {canWrite && onReportDamage && (
                    <Button variant="secondary" size="sm" onClick={onReportDamage}>
                        Schaden melden
                    </Button>
                )}
            </div>

            {empty ? (
                <p className={styles.empty}>Keine offenen Hinweise.</p>
            ) : (
                <ul className={styles.list}>
                    {openDamages.map((damage) => (
                        <li key={`damage-${damage.id}`} className={styles.item} data-tone={damage.drivable ? undefined : "danger"}>
                            <span className={styles.damageChip} data-tone={damage.drivable ? "warning" : "danger"}>
                                Schaden
                            </span>
                            {canWrite && onEditDamage ? (
                                // The text opens the damage; the row button
                                // is the next step, the workshop.
                                <button
                                    type="button"
                                    className={`${styles.message} ${styles.messageButton}`}
                                    onClick={() => onEditDamage(damage)}
                                >
                                    {damageText(damage)}
                                </button>
                            ) : (
                                <p className={styles.message}>{damageText(damage)}</p>
                            )}
                            {damageStay(damage) ? (
                                <span className={styles.stay}>{damageStay(damage)}</span>
                            ) : canPlan ? (
                                <Button
                                    variant="ghost"
                                    size="row"
                                    onClick={() => onPlanWorkshop?.({ reason: "DAMAGE", damageId: damage.id })}
                                >
                                    Termin planen
                                </Button>
                            ) : null}
                        </li>
                    ))}
                    {hasSpeeding && (
                        <li className={styles.item} data-tone="danger">
                            <WarningChip type="SPEEDING" />
                            <p className={styles.message}>
                                {speedingDetails
                                    ? `${speedingDetails.max_speed_kmh} km/h bei Limit ${speedingDetails.limit_kmh}`
                                    : "Offene Tempo-Warnung"}
                                {speeding && (
                                    <small>
                                        {[
                                            `Fahrt ${formatShortStamp(speeding.alert.created_at)}`,
                                            speeding.alert.driver_name,
                                            speeding.total > 1 ? `${speeding.total} offene Tempo-Warnungen` : null,
                                        ]
                                            .filter(Boolean)
                                            .join(" · ")}
                                    </small>
                                )}
                            </p>
                            {speeding?.alert.trip_id && onShowTrip ? (
                                <Button
                                    variant="ghost"
                                    size="row"
                                    onClick={() => onShowTrip(speeding.alert.trip_id as number)}
                                >
                                    Fahrt zeigen
                                </Button>
                            ) : (
                                <Link className={styles.inboxLink} to={`/alerts?vehicle_id=${vehicle.id}&type=SPEEDING`}>
                                    Warnungen
                                </Link>
                            )}
                        </li>
                    )}
                    {noSignal && (
                        <li className={styles.item} data-tone="danger">
                            <WarningChip type="OFFLINE" />
                            <p className={styles.message}>
                                {offline?.since ? `Meldet sich nicht ${formatSince(offline.since)}` : "Meldet sich nicht"}
                                <small>
                                    {offline?.phone
                                        ? `Fahrer anrufen: ${offline.phone}`
                                        : vehicle.driver_name
                                          ? `${vehicle.driver_name}, keine Telefonnummer eingetragen`
                                          : "Kein Fahrer eingeteilt"}
                                </small>
                            </p>
                        </li>
                    )}
                    {tankLow && (
                        <li className={styles.item}>
                            <WarningChip type="LOW_FUEL" />
                            <p className={styles.message}>
                                Tank bei {Math.round(vehicle.fuel_level)} %
                                <small>Nach der Fahrt im Stammdaten-Formular eintragen.</small>
                            </p>
                        </li>
                    )}
                    {deadlines.map((deadline) => (
                        <li
                            key={deadline.reason}
                            className={styles.item}
                            data-tone={deadline.state === "overdue" ? "warning" : undefined}
                        >
                            <InspectionPlaque
                                dueOn={deadline.due_on}
                                state={deadline.state}
                                size={28}
                                label={`${deadline.reason}-Plakette ${deadlineDate(deadline)}`}
                            />
                            <p className={styles.message}>
                                {deadline.state === "overdue" ? (
                                    <b className={styles.expired}>{deadline.reason} abgelaufen</b>
                                ) : (
                                    `${deadline.reason}-Datum fehlt`
                                )}
                                {deadline.due_on && (
                                    <small>
                                        {deadlineDate(deadline)} · {expiredSinceText(deadline.due_on, today)}
                                        {vehicle.workshop && !vehicle.workshop.reasons.includes(deadline.reason)
                                            ? ` · Termin am ${formatIsoDate(vehicle.workshop.planned_on)} ohne ${deadline.reason}`
                                            : ""}
                                    </small>
                                )}
                            </p>
                            {deadlineAction(deadline)}
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
};
