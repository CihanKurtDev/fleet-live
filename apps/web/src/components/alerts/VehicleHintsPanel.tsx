import { Link } from "react-router";
import {
    DUE_KIND_LABELS,
    berlinTodayIso,
    classifyDueOn,
    explainHuMonth,
    explainUvv,
    isLowFuelLevel,
    type Vehicle,
} from "@fleet-live/shared";

import { formatIsoDate } from "../../utils/dateTime";
import { Button } from "../ui/Button/Button";
import type { VehicleFormField } from "../vehicles/VehicleForm";
import { WarningChip } from "./WarningChip";
import styles from "./VehicleHintsPanel.module.scss";

interface VehicleHintsPanelProps {
    vehicle: Vehicle;
    canWrite: boolean;
    /** Opens the master-data form on the field that takes the missing date. */
    onEditMaster?: (field: VehicleFormField) => void;
}

type DueHint = {
    kind: "hu" | "uvv";
    state: "overdue" | "missing";
    due_on: string | null;
};

/**
 * HU and UVV of this vehicle that need a date now: missing or past. "Soon"
 * depends on the company lead and stays on /fristen.
 */
const dueHintsFor = (vehicle: Vehicle): DueHint[] => {
    const today = berlinTodayIso();
    const dates = [
        {
            kind: "hu" as const,
            due_on: explainHuMonth(vehicle.hu_due_on).due_on,
        },
        {
            kind: "uvv" as const,
            due_on: explainUvv({
                checkedOn: vehicle.uvv_checked_on,
                manualDueOn: vehicle.uvv_due_on,
                today,
            }).due_on,
        },
    ];

    return dates.flatMap(({ kind, due_on }) => {
        const state = classifyDueOn(due_on, today, 0);

        return state === "overdue" || state === "missing"
            ? [{ kind, state, due_on }]
            : [];
    });
};

const dueHintText = (hint: DueHint): string =>
    hint.state === "missing"
        ? `${DUE_KIND_LABELS[hint.kind]}-Datum fehlt`
        : `${DUE_KIND_LABELS[hint.kind]} war am ${formatIsoDate(hint.due_on)} fällig`;

export const VehicleHintsPanel = ({
    vehicle,
    canWrite,
    onEditMaster,
}: VehicleHintsPanelProps) => {
    const inboxHref = `/alerts?vehicle_id=${vehicle.id}&type=OFFLINE`;
    const tankLow = isLowFuelLevel(vehicle.fuel_level);
    // The warning closes itself when the vehicle reports again, so it is
    // there exactly while the vehicle has no signal.
    const noSignal =
        vehicle.status === "OFFLINE" ||
        vehicle.open_alert_types.includes("OFFLINE");

    const showTank = tankLow;
    const showFunk = noSignal;
    const dueHints = dueHintsFor(vehicle);

    return (
        <>
            <div className={styles.header}>
                <h2 className={styles.panelTitle}>Hinweise</h2>
                {showFunk ? (
                    <Link className={styles.inboxLink} to={inboxHref}>
                        Zu den Warnungen
                    </Link>
                ) : null}
            </div>

            {!showTank && !showFunk && dueHints.length === 0 ? (
                <p className={styles.empty}>Keine offenen Hinweise.</p>
            ) : (
                <ul className={styles.list}>
                    {showFunk && (
                        <li className={styles.item} data-tone="danger">
                            <WarningChip type="OFFLINE" />
                            <p className={styles.message}>Meldet sich nicht.</p>
                        </li>
                    )}
                    {showTank && (
                        <li className={styles.item}>
                            <WarningChip type="LOW_FUEL" />
                            <p className={styles.message}>
                                Tank bei {Math.round(vehicle.fuel_level)} % —
                                nach der Fahrt im Stammdaten-Formular
                                eintragen.
                            </p>
                        </li>
                    )}
                    {dueHints.map((hint) => (
                        <li key={hint.kind} className={styles.item}>
                            <span className={styles.dueChip}>Frist</span>
                            <p className={styles.message}>
                                {dueHintText(hint)}
                            </p>
                            {canWrite && onEditMaster ? (
                                <Button
                                    variant="ghost"
                                    size="row"
                                    onClick={() =>
                                        onEditMaster(
                                            hint.kind === "hu" ? "hu" : "uvv-checked",
                                        )
                                    }
                                >
                                    Eintragen
                                </Button>
                            ) : (
                                <Link
                                    className={styles.inboxLink}
                                    to={`/fristen?state=${hint.state}&kind=${hint.kind}&search=${encodeURIComponent(vehicle.license_plate)}`}
                                >
                                    Fristen
                                </Link>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
};
