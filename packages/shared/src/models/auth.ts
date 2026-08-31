import { z } from "zod";

export type AuthUser = {
    id: number;
    name: string;
    email: string;
    company_id: number;
};

export type LoginInput = {
    email: string;
    password: string;
};

const loginSchema = z.object({
    email: z
        .string({ error: "E-Mail ist erforderlich." })
        .trim()
        .min(1, "E-Mail ist erforderlich.")
        .email("E-Mail ist ungültig.")
        .max(255, "E-Mail darf höchstens 255 Zeichen haben."),
    password: z
        .string({ error: "Passwort ist erforderlich." })
        .min(1, "Passwort ist erforderlich.")
        .max(200, "Passwort darf höchstens 200 Zeichen haben."),
});

export function parseLoginInput(input: unknown): LoginInput {
    return loginSchema.parse(input);
}
