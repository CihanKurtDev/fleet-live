import { createContext } from "react";
import type { AuthUser } from "@fleet-live/shared";

export type AuthContextValue = {
    user: AuthUser | null;
    isReady: boolean;
    setUser: (user: AuthUser | null) => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
