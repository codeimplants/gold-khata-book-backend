import { Request, Response, NextFunction } from "express";

export const errorMiddleware = (err: any, req: Request, res: Response, _next: NextFunction) => {
    // Determine status code - strictly ensure it's an error code (>= 400)
    let statusCode = 500;
    let code = err.code || "INTERNAL_ERROR";
    
    // Handle Zod Validation Errors
    if (err.name === 'ZodError') {
        statusCode = 400;
        code = "ZOD_VALIDATION_ERROR";
        // Map zod errors to a cleaner format
        err.details = err.issues.map((issue: any) => ({
            path: issue.path.join('.'),
            message: issue.message
        }));
    } else if (err.name === 'ValidationError') {
        statusCode = 400;
        code = "VALIDATION_ERROR";
    } else if (err.name === 'MulterError') {
        // Multer sets a string code (LIMIT_FILE_SIZE, LIMIT_FILE_COUNT, ...) and
        // no statusCode, so without this an oversized upload surfaces as a 500
        // "File too large" — reported to the user as a server fault when it is
        // squarely a client-side one, and not retryable-looking.
        statusCode = 413;
        code = "BAD_REQUEST";
        err.message =
            err.code === "LIMIT_FILE_SIZE"
                ? "That image is too large. Please choose a smaller photo."
                : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE"
                    ? "Too many files in one upload."
                    : err.message;
    } else if (err.statusCode && typeof err.statusCode === 'number' && err.statusCode >= 400) {
        statusCode = err.statusCode;
    } else if (err.status && typeof err.status === 'number' && err.status >= 400) {
        statusCode = err.status;
    }

    const message = err.message || "Internal Server Error";

    // Set status explicitly on res
    res.status(statusCode);

    // rid ties this to the [req] line and to nginx's entry for the same call.
    console.error(`[ErrorMiddleware] rid=${req.id} ${statusCode} - ${message}`);

    // Stack traces go to the log, never to the client unless this is explicitly
    // a development environment.
    //
    // This used to read `NODE_ENV === 'production' ? undefined : err.stack`,
    // which never matched: every environment here is deployed with NODE_ENV set
    // to dev / preprod / prod, so production leaked full stack traces to any
    // unauthenticated caller — framework, file paths and internal call chain.
    //
    // Deliberately allow-listed rather than deny-listed. The old form failed
    // open on an unrecognised value; this one fails closed, so a new environment
    // name or a missing NODE_ENV hides the stack rather than exposing it.
    const isDevEnv = ['dev', 'development', 'local', 'test'].includes(
        (process.env.NODE_ENV ?? '').toLowerCase(),
    );

    res.json({
        success: false,
        message,
        code,
        details: err.details,
        ...(isDevEnv ? { stack: err.stack } : {}),
    });
};