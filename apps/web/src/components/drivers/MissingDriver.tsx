import { useContext } from "react";
import { AuthContext } from "../../context/authContext";

/**
 * What stands where a driver name is missing: kept from viewers by the
 * company (Konto → Datenschutz), or simply not recorded (`fallback`).
 * Reads the session without requiring it, so a table renders on its own.
 */
export const MissingDriver = ({
    fallback,
    className,
}: {
    fallback: string;
    className?: string;
}) => {
    const user = useContext(AuthContext)?.user;

    return (
        <span className={className}>
            {user?.driver_names_hidden ? "nur für Dispatcher" : fallback}
        </span>
    );
};
