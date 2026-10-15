import { NavLink } from "react-router";
import { Button } from "./ui/Button/Button";
import { CompanySwitch } from "./CompanySwitch";
import { useAuth } from "../hooks/useAuth";
import { useLogout } from "../hooks/useLogout";
import styles from "./SessionMenu.module.scss";

export const SessionMenu = () => {
    const { user, isReady } = useAuth();
    const handleLogout = useLogout();

    if (!isReady) {
        return null;
    }

    if (!user) {
        return (
            <NavLink className={styles.signIn} to="/login">
                Anmelden
            </NavLink>
        );
    }

    return (
        <div className={styles.menu}>
            <div className={styles.identity}>
                {user.memberships.length > 1 ? (
                    <CompanySwitch />
                ) : (
                    <span className={styles.company}>{user.company_name}</span>
                )}
                <NavLink
                    to="/konto"
                    className={styles.account}
                    aria-label={`Konto, ${user.name}`}
                >
                    {user.name}
                </NavLink>
            </div>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
                Abmelden
            </Button>
        </div>
    );
};
