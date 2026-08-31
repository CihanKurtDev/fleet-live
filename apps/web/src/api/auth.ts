import type { AuthUser, LoginInput } from "@fleet-live/shared";
import { request } from "./client";

export const login = (input: LoginInput, signal?: AbortSignal) =>
    request<AuthUser>("/api/auth/login", {
        method: "POST",
        body: input,
        signal,
    });

export const logout = (signal?: AbortSignal) =>
    request<void>("/api/auth/logout", {
        method: "POST",
        signal,
    });

export const getMe = (signal?: AbortSignal) =>
    request<AuthUser>("/api/auth/me", { signal });
