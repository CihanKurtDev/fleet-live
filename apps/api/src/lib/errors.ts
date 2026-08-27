export type FieldErrors = Record<string, string>;

export class AppError extends Error {
    readonly status: number;
    readonly code: string;
    readonly fields?: FieldErrors;
    readonly isOperational = true;

    constructor(
        status: number,
        code: string,
        message: string,
        fields?: FieldErrors,
    ) {
        super(message);
        this.name = "AppError";
        this.status = status;
        this.code = code;
        this.fields = fields;
    }
}

export class ValidationError extends AppError {
    constructor(message: string, fields?: FieldErrors) {
        super(400, "VALIDATION_ERROR", message, fields);
    }
}

export class BadRequestError extends AppError {
    constructor(message: string) {
        super(400, "BAD_REQUEST", message);
    }
}

export class NotFoundError extends AppError {
    constructor(message = "Fahrzeug nicht gefunden.") {
        super(404, "NOT_FOUND", message);
    }
}

export class ConflictError extends AppError {
    constructor(message = "Kennzeichen ist bereits vergeben.") {
        super(409, "CONFLICT", message, {
            license_plate: "Kennzeichen ist bereits vergeben.",
        });
    }
}

/**
 * SQLITE_CONSTRAINT_UNIQUE = 2067.
 * SQLITE_CONSTRAINT = 19 als Fallback, falls die Extended-Codes fehlen.
 */
export function isUniqueConstraintError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const sqliteError = error as Error & {
        code?: string;
        errcode?: number;
    };

    if (sqliteError.code === "ERR_SQLITE_ERROR") {
        return sqliteError.errcode === 2067 || sqliteError.errcode === 19;
    }

    return /UNIQUE/i.test(error.message);
}
