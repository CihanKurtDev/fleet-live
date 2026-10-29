import type {
    AuditEvent,
    AuthUser,
    CompanyDomain,
    Invitation,
    LoginInput,
    LoginResponse,
    MailDelivery,
    SsoProviders,
    UserRole,
} from "@fleet-live/shared";
import { request } from "./client";

type MailResult = {
    email?: string;
    delivery: MailDelivery;
    message: string;
};

export const login = (input: LoginInput, signal?: AbortSignal) =>
    request<LoginResponse>("/api/auth/login", {
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

export const getSsoProviders = (signal?: AbortSignal) =>
    request<SsoProviders>("/api/auth/sso/providers", { signal });

/** Starts linking an external login; the browser then goes to `url`. */
export const startSsoLink = (input: {
    provider: "google" | "microsoft" | "company";
    company_id?: number;
    challenge?: string;
}) =>
    request<{ url: string }>("/api/auth/sso/link", {
        method: "POST",
        body: input,
    });

/** Removes the person's own Google or Microsoft link. */
export const unlinkSso = (provider: "google" | "microsoft") =>
    request<AuthUser>(`/api/auth/sso/links/${provider}`, { method: "DELETE" });

export const discoverCompanySso = (email: string) =>
    request<{ company_id: number }>("/api/auth/sso/company/discover", {
        method: "POST",
        body: { email },
    });

export const registerAccount = (input: {
    company_name: string;
    name: string;
    email: string;
    password: string;
}) =>
    request<MailResult>("/api/auth/register", {
        method: "POST",
        body: input,
    });

export const resendVerification = (email: string) =>
    request<MailResult>("/api/auth/resend-verification", {
        method: "POST",
        body: { email },
    });

export const verifyEmail = (token: string) =>
    request<void>("/api/auth/verify-email", {
        method: "POST",
        body: { token },
    });

export const forgotPassword = (email: string) =>
    request<MailResult>("/api/auth/forgot-password", {
        method: "POST",
        body: { email },
    });

export const resetPassword = (token: string, password: string) =>
    request<void>("/api/auth/reset-password", {
        method: "POST",
        body: { token, password },
    });

export const changePassword = (current_password: string, password: string) =>
    request<void>("/api/auth/password", {
        method: "POST",
        body: { current_password, password },
    });

export const acceptInvite = (input: {
    token: string;
    name: string;
    password: string;
}) =>
    // `next: "login"` when the company requires more than the password.
    request<AuthUser | { next: "login" }>("/api/auth/invites/accept", {
        method: "POST",
        body: input,
    });

export const switchCompany = (company_id: number) =>
    request<AuthUser>("/api/auth/company", {
        method: "POST",
        body: { company_id },
    });

export const createCompany = (name: string) =>
    request<AuthUser>("/api/auth/companies", {
        method: "POST",
        body: { name },
    });

export const dismissImportPrompt = () =>
    request<AuthUser>("/api/auth/import-prompt/dismiss", { method: "POST" });

export type Member = {
    user_id: number;
    name: string;
    email: string;
    role: UserRole;
    /** Invited, not accepted yet: no access to the company. */
    invited: boolean;
};

export const withdrawInvite = (userId: number) =>
    request<{ data: Member[] }>(`/api/auth/invites/${userId}`, {
        method: "DELETE",
    });

export const listDomains = (signal?: AbortSignal) =>
    request<{ data: CompanyDomain[] }>("/api/auth/domains", { signal });

export const addDomain = (domain: string) =>
    request<{ data: CompanyDomain }>("/api/auth/domains", {
        method: "POST",
        body: { domain },
    });

export const verifyDomain = (id: number) =>
    request<{ data: CompanyDomain[] }>(`/api/auth/domains/${id}/verify`, {
        method: "POST",
    });

export const removeDomain = (id: number) =>
    request<{ data: CompanyDomain[] }>(`/api/auth/domains/${id}`, {
        method: "DELETE",
    });

export type AuditPage = {
    data: AuditEvent[];
    meta: { page: number; limit: number; total: number; pageCount: number };
};

export const listAudit = (page: number, signal?: AbortSignal) =>
    request<AuditPage>(`/api/auth/audit?page=${page}`, { signal });

export const listInvitations = (signal?: AbortSignal) =>
    request<{ data: Invitation[] }>("/api/auth/invitations", { signal });

export const acceptInvitation = (companyId: number) =>
    request<AuthUser>(`/api/auth/invitations/${companyId}/accept`, {
        method: "POST",
    });

export const declineInvitation = (companyId: number) =>
    request<AuthUser>(`/api/auth/invitations/${companyId}`, {
        method: "DELETE",
    });

export const listMembers = () =>
    request<{ data: Member[] }>("/api/auth/members");

export const inviteMember = (email: string, role: UserRole) =>
    request<MailResult>("/api/auth/invites", {
        method: "POST",
        body: { email, role },
    });

export const setMemberRole = (userId: number, role: UserRole) =>
    request<{ data: Member[] }>(`/api/auth/members/${userId}`, {
        method: "PATCH",
        body: { role },
    });

export const removeMember = (userId: number) =>
    request<void>(`/api/auth/members/${userId}`, { method: "DELETE" });

export type CompanySecurity = {
    totp_required: boolean;
    sso_required: boolean;
    sso_issuer: string | null;
    sso_client_id: string | null;
    sso_configured: boolean;
    sso_secret_set: boolean;
};

export const getSecurity = () =>
    request<CompanySecurity>("/api/auth/security");

export const updateSecurity = (input: {
    totp_required?: boolean;
    sso_required?: boolean;
    sso_issuer?: string | null;
    sso_client_id?: string | null;
    sso_client_secret?: string | null;
}) =>
    request<CompanySecurity>("/api/auth/security", {
        method: "PATCH",
        body: input,
    });

type TotpSetup = {
    secret: string;
    otpauth_url: string;
    setup_token?: string;
};

export const setupTotp = (challenge?: string) =>
    request<TotpSetup>("/api/auth/totp/setup", {
        method: "POST",
        body: challenge ? { challenge } : {},
    });

export const confirmTotp = (input: {
    code: string;
    challenge?: string;
    setup_token?: string;
}) =>
    request<AuthUser & { recovery_codes?: string[] }>("/api/auth/totp", {
        method: "POST",
        body: input,
    });

export const disableTotp = (code: string) =>
    request<AuthUser>("/api/auth/totp/disable", {
        method: "POST",
        body: { code },
    });

export const confirmTotpSetup = (input: {
    code: string;
    setup_token: string;
}) =>
    request<AuthUser & { recovery_codes?: string[] }>("/api/auth/totp/confirm", {
        method: "POST",
        body: input,
    });
