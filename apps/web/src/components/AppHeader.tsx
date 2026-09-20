import { Link, NavLink } from "react-router";
import { SimToggle } from "./SimToggle";
import { SessionMenu } from "./SessionMenu";
import { useAuth } from "../hooks/useAuth";
import { formatCount } from "../utils/formatCount";
import styles from "./AppHeader.module.scss";

export const AppHeader = ({
    openAlertCount,
}: {
    openAlertCount?: number;
}) => {
    const { user } = useAuth();

    return (
        <header className={styles.header}>
            <div className={styles.start}>
                <Link className={styles.brand} to={user ? "/" : "/login"}>
                    fleet-live
                </Link>
                {user && (
                    <nav className={styles.nav} aria-label="Hauptnavigation">
                        <NavLink
                            to="/vehicles"
                            className={({ isActive }) =>
                                isActive ? styles.active : undefined
                            }
                        >
                            Fahrzeuge
                        </NavLink>
                        <NavLink
                            to="/fleet"
                            aria-label="Flottenkarte"
                            className={({ isActive }) =>
                                isActive ? styles.active : undefined
                            }
                        >
                            Karte
                        </NavLink>
                        <NavLink
                            to="/alerts"
                            className={({ isActive }) =>
                                isActive ? styles.active : undefined
                            }
                        >
                            Warnungen
                            {openAlertCount !== undefined &&
                            openAlertCount > 0 ? (
                                <span className={styles.badge}>
                                    {formatCount(openAlertCount)}
                                </span>
                            ) : null}
                        </NavLink>
                        <NavLink
                            to="/drivers"
                            className={({ isActive }) =>
                                isActive ? styles.active : undefined
                            }
                        >
                            Fahrer
                        </NavLink>
                    </nav>
                )}
            </div>
            <div className={styles.end}>
                {user && user.role === "dispatcher" && <SimToggle />}
                <SessionMenu className={styles.session} />
            </div>
        </header>
    );
};
