import { useState } from "react";
import { switchCompany } from "../api/auth";
import { useAuth } from "../hooks/useAuth";
import styles from "./CompanySwitch.module.scss";
import { Select } from "./ui/Select/Select";

export const CompanySwitch = ({ fullWidth = false }: { fullWidth?: boolean }) => {
    const { user, setUser } = useAuth();
    const [switchError, setSwitchError] = useState<string | null>(null);

    if (!user) {
        return null;
    }

    return (
        <div
            className={
                fullWidth ? `${styles.field} ${styles.fullWidth}` : styles.field
            }
        >
            <Select
                className={styles.select}
                size={fullWidth ? "md" : "sm"}
                aria-label="Firma"
                value={user.company_id}
                onChange={async (event) => {
                    setSwitchError(null);

                    try {
                        const next = await switchCompany(
                            Number(event.target.value),
                        );
                        setUser(next);
                    } catch {
                        setUser(user);
                        setSwitchError("Firma konnte nicht gewechselt werden.");
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
            </Select>
            {switchError && (
                <span className={styles.error} role="alert">
                    {switchError}
                </span>
            )}
        </div>
    );
};
