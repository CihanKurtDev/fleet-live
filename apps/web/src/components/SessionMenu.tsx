import { NavLink } from "react-router";
import { logout, switchCompany } from "../api/auth";
import { Button } from "./ui/Button/Button";
import { useAuth } from "../hooks/useAuth";
import styles from "./SessionMenu.module.scss";

export const SessionMenu = () => {
    const { user, isReady, setUser } = useAuth();

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

    const handleLogout = async () => {
        try {
            await logout();
        } catch {
            // Die lokale Sitzung endet auch, wenn der Server nicht antwortet.
        }

        setUser(null);
    };

    return (
        <div className={styles.menu}>
            <div className={styles.identity}>
                {user.memberships.length > 1 ? (
                    <select
                        className={styles.companySelect}
                        aria-label="Firma"
                        value={user.company_id}
                        onChange={async (event) => {
                            try {
                                const next = await switchCompany(
                                    Number(event.target.value),
                                );
                                setUser(next);
                            } catch {
                                setUser(user);
                            }
                        }}
                    >
                        {user.memberships.map((membership) => (
                            <option
                                key={membership.company_id}
                                value={membership.company_id}
                            >
                                {membership.company_name}
                            </option>
                        ))}
                    </select>
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
