import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthUser } from "@fleet-live/shared";
import { getMe, logout } from "../api/auth";
import {
    ApiError,
    isAbortError,
    setUnauthorizedHandler,
} from "../api/client";
import { AuthContext } from "./authContext";

const IDLE_MS = 15 * 60 * 1000;

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        setUnauthorizedHandler(() => setUser(null));
        return () => setUnauthorizedHandler(null);
    }, []);

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
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsReady(true);
                }
            });

        return () => controller.abort();
    }, []);

    useEffect(() => {
        if (!user) {
            return;
        }

        let timer = window.setTimeout(() => {
            void logout().finally(() => setUser(null));
        }, IDLE_MS);

        const reset = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => {
                void logout().finally(() => setUser(null));
            }, IDLE_MS);
        };

        window.addEventListener("pointerdown", reset);
        window.addEventListener("keydown", reset);

        return () => {
            window.clearTimeout(timer);
            window.removeEventListener("pointerdown", reset);
            window.removeEventListener("keydown", reset);
        };
    }, [user]);

    const value = useMemo(
        () => ({ user, isReady, setUser }),
        [user, isReady],
    );

    return (
        <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    );
};
