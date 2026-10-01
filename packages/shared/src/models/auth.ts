import { z } from "zod";

export const USER_ROLES = ["dispatcher", "viewer"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export type MembershipSummary = {
    company_id: number;
    company_name: string;
    role: UserRole;
};

export type AuthUser = {
    id: number;
    name: string;
    email: string;
    company_id: number;
    company_name: string;
    role: UserRole;
    memberships: MembershipSummary[];
    totp_enabled: boolean;
    import_prompt: boolean;
};

export type LoginInput = {
    email: string;
    password: string;
    remember: boolean;
};

export type LoginChallenge = {
    step: "totp" | "totp_enroll";
    challenge: string;
};

export type LoginResponse = AuthUser | LoginChallenge;

export type MailDelivery = "log" | "smtp";

export type SsoProviders = {
    google: boolean;
    microsoft: boolean;
};

const emailSchema = z
    .string({ error: "E-Mail ist erforderlich." })
    .trim()
    .min(1, "E-Mail ist erforderlich.")
    .email("E-Mail ist ungültig.")
    .max(255, "E-Mail darf höchstens 255 Zeichen haben.")
    .transform((value) => value.toLowerCase());

export const passwordSchema = z
    .string({ error: "Passwort ist erforderlich." })
    .min(
        PASSWORD_MIN_LENGTH,
        `Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen haben.`,
    )
    .max(
        PASSWORD_MAX_LENGTH,
        `Passwort darf höchstens ${PASSWORD_MAX_LENGTH} Zeichen haben.`,
    );

const personNameSchema = z
    .string({ error: "Name ist erforderlich." })
    .trim()
    .min(1, "Name ist erforderlich.")
    .max(120, "Name darf höchstens 120 Zeichen haben.");

const companyNameSchema = z
    .string({ error: "Firmenname ist erforderlich." })
    .trim()
    .min(1, "Firmenname ist erforderlich.")
    .max(120, "Firmenname darf höchstens 120 Zeichen haben.");

const loginSchema = z.object({
    email: emailSchema,
    password: passwordSchema,
    remember: z.boolean().optional().default(false),
});

const registerSchema = z.object({
    company_name: companyNameSchema,
    name: personNameSchema,
    email: emailSchema,
    password: passwordSchema,
});

const emailOnlySchema = z.object({
    email: emailSchema,
});

const tokenSchema = z.object({
    token: z
        .string({ error: "Link ist ungültig." })
        .trim()
        .min(1, "Link ist ungültig.")
        .max(200, "Link ist ungültig."),
});

const resetSchema = tokenSchema.extend({
    password: passwordSchema,
});

const acceptInviteSchema = tokenSchema.extend({
    name: personNameSchema,
    password: passwordSchema,
});

const changePasswordSchema = z.object({
    current_password: z
        .string({ error: "Aktuelles Passwort ist erforderlich." })
        .min(1, "Aktuelles Passwort ist erforderlich.")
        .max(PASSWORD_MAX_LENGTH, "Aktuelles Passwort ist zu lang."),
    password: passwordSchema,
});

const inviteSchema = z.object({
    email: emailSchema,
    role: z.enum(USER_ROLES, { error: "Rolle ist ungültig." }),
});

const companySchema = z.object({
    name: companyNameSchema,
});

const switchCompanySchema = z.object({
    company_id: z
        .number({ error: "Firma ist erforderlich." })
        .int()
        .positive("Firma ist ungültig."),
});

const memberRoleSchema = z.object({
    role: z.enum(USER_ROLES, { error: "Rolle ist ungültig." }),
});

const totpCodeSchema = z.object({
    code: z
        .string({ error: "Code ist erforderlich." })
        .trim()
        .min(6, "Code ist ungültig.")
        .max(32, "Code ist ungültig."),
    challenge: z.string().trim().min(1).max(200).optional(),
    setup_token: z.string().trim().min(1).max(200).optional(),
});

const securitySchema = z
    .object({
        totp_required: z.boolean().optional(),
        sso_required: z.boolean().optional(),
        sso_issuer: z
            .string()
            .trim()
            .url("Issuer ist keine gültige URL.")
            .max(500)
            .nullable()
            .optional(),
        sso_client_id: z.string().trim().min(1).max(200).nullable().optional(),
        sso_client_secret: z
            .string()
            .trim()
            .min(1)
            .max(500)
            .nullable()
            .optional(),
    })
    .refine((value) => !value.sso_required || Boolean(value.sso_issuer), {
        path: ["sso_issuer"],
        message: "Für den Firmen-Login braucht es einen Issuer.",
    });

export type RegisterInput = z.infer<typeof registerSchema>;
export type InviteInput = z.infer<typeof inviteSchema>;
export type SecurityInput = z.infer<typeof securitySchema>;

export function parseLoginInput(input: unknown): LoginInput {
    return loginSchema.parse(input);
}

export function parseRegisterInput(input: unknown): RegisterInput {
    return registerSchema.parse(input);
}

export function parseEmailInput(input: unknown): { email: string } {
    return emailOnlySchema.parse(input);
}

export function parseTokenInput(input: unknown): { token: string } {
    return tokenSchema.parse(input);
}

export function parseResetInput(input: unknown): {
    token: string;
    password: string;
} {
    return resetSchema.parse(input);
}

export function parseAcceptInviteInput(input: unknown): {
    token: string;
    name: string;
    password: string;
} {
    return acceptInviteSchema.parse(input);
}

export function parseChangePasswordInput(input: unknown): {
    current_password: string;
    password: string;
} {
    return changePasswordSchema.parse(input);
}

export function parseInviteInput(input: unknown): InviteInput {
    return inviteSchema.parse(input);
}

export function parseCompanyInput(input: unknown): { name: string } {
    return companySchema.parse(input);
}

export function parseSwitchCompanyInput(input: unknown): {
    company_id: number;
} {
    return switchCompanySchema.parse(input);
}

export function parseMemberRoleInput(input: unknown): { role: UserRole } {
    return memberRoleSchema.parse(input);
}

export function parseTotpCodeInput(input: unknown): {
    code: string;
    challenge?: string;
    setup_token?: string;
} {
    return totpCodeSchema.parse(input);
}

export function parseSecurityInput(input: unknown): SecurityInput {
    return securitySchema.parse(input);
}

export function isLoginChallenge(value: LoginResponse): value is LoginChallenge {
    return "step" in value;
}
