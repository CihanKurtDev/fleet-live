import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthUser } from "@fleet-live/shared";
import { getMe } from "../api/auth";
import { ApiError, isAbortError } from "../api/client";
import { AuthContext } from "./authContext";

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        const controller = new AbortController();

        getMe(controller.signal)
            .then(setUser)
            .catch((caught: unknown) => {
                if (isAbortError(caught)) {
                    return;
                }

                if (caught instanceof ApiError && caught.status === 401) {
                    setUser(null);
                    return;
                }

                setUser(null);
            })
            .finally(() => setIsReady(true));

        return () => controller.abort();
    }, []);

    const value = useMemo(
        () => ({ user, isReady, setUser }),
        [user, isReady],
    );

    return (
        <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    );
};
