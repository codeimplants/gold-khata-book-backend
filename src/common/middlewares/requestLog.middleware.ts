import { Request, Response, NextFunction } from "express";

/**
 * One line per finished request — the server-side counterpart to nginx's
 * access log, keyed by the same request id.
 *
 * Logged on "finish" rather than on arrival so the status code and duration
 * are the real ones. Both matter for the class of bug this was added for: a
 * duplicate or retried POST is invisible in a log that only records failures,
 * and "the same request arrived three times in 400ms" is the observation that
 * identifies it.
 *
 * Deliberately no request bodies and no query strings: those carry phone
 * numbers and one-time codes, and these files are readable by every account in
 * the `adm` group.
 */
export const requestLogMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const startedAt = process.hrtime.bigint();

    // Read from originalUrl, not req.path, and read it now rather than in the
    // finish handler. Express rewrites req.url — and therefore req.path — as a
    // request descends into a mounted sub-router, stripping the prefix, and the
    // mutation is still in place when "finish" fires. A POST to
    // /api/login/verify-otp logged itself as /verify-otp, so grepping the log
    // for the endpoint you actually called found nothing. originalUrl is never
    // rewritten; the query string is split off because it carries phone numbers.
    const path = req.originalUrl.split("?")[0];

    res.on("finish", () => {
        const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
        console.log(
            `[req] rid=${req.id} ${req.method} ${path} ${res.statusCode} ${ms.toFixed(1)}ms`,
        );
    });

    next();
};
