import { NavLink } from "react-router";
import { logout } from "../api/auth";
import { Button } from "./ui/Button/Button";
import { useAuth } from "../hooks/useAuth";

export const SessionMenu = () => {
    const { user, isReady, setUser } = useAuth();

    if (!isReady) {
        return null;
    }

    if (!user) {
        return (
            <NavLink className="appSession" to="/login">
                Anmelden
            </NavLink>
        );
    }

    const handleLogout = async () => {
        try {
            await logout();
        } finally {
            setUser(null);
        }
    };

    return (
        <div className="appSession">
            <span>{user.name}</span>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
                Abmelden
            </Button>
        </div>
    );
};
