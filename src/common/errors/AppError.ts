export type ErrorCode =
    | "BAD_REQUEST"
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "CONFLICT"
    | "VALIDATION_ERROR"
    | "INTERNAL_ERROR";

export interface AppErrorOptions {
    statusCode?: number;
    code?: ErrorCode;
    details?: unknown;
}

export class AppError extends Error {
    statusCode: number;
    code: ErrorCode;
    details?: unknown;

    constructor(message: string, options: AppErrorOptions = {}) {
        super(message);
        this.name = "AppError";
        this.statusCode = options.statusCode ?? 500;
        this.code = options.code ?? "INTERNAL_ERROR";
        this.details = options.details;

        Error.captureStackTrace?.(this, this.constructor);
    }
}