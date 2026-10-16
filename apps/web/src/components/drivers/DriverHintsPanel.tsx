import { Link } from "react-router";
import type { DriverDetail } from "@fleet-live/shared";

import { Button } from "../ui/Button/Button";
import { driverHints, type DriverFormField } from "./driverHints";
import detail from "./driverDetail.module.scss";
import styles from "./DriverHintsPanel.module.scss";

interface DriverHintsPanelProps {
    driver: DriverDetail;
    canWrite: boolean;
    /** Months between licence checks (company setting, 0 = off). */
    checkMonths: number;
    /** Opens the existing edit form on the field the hint asks for. */
    onEdit: (field: DriverFormField) => void;
}

export const DriverHintsPanel = ({
    driver,
    canWrite,
    checkMonths,
    onEdit,
}: DriverHintsPanelProps) => {
    const hints = driverHints(driver, checkMonths);

    return (
        <section className={detail.panel} aria-label="Hinweise">
            <div className={detail.panelHeader}>
                <h2 className={detail.panelTitle}>Hinweise</h2>
            </div>

            {hints.length === 0 ? (
                <p className={detail.empty}>Keine offenen Hinweise.</p>
            ) : (
                <ul className={styles.list}>
                    {hints.map((hint) => (
                        <li key={hint.key} className={styles.item}>
                            <span className={styles.tag} data-tone={hint.tone}>
                                {hint.tag}
                            </span>
                            <p className={styles.message}>{hint.text}</p>
                            {canWrite ? (
                                <Button
                                    variant="ghost"
                                    size="row"
                                    onClick={() => onEdit(hint.field)}
                                >
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
        </section>
    );
};
