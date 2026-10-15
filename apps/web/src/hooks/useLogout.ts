import { useCallback } from "react";
import { logout } from "../api/auth";
import { useAuth } from "./useAuth";

export const useLogout = () => {
    const { setUser } = useAuth();

    return useCallback(async () => {
        try {
            await logout();
        } catch {
            // Die lokale Sitzung endet auch, wenn der Server nicht antwortet.
        }

        setUser(null);
    }, [setUser]);
};
