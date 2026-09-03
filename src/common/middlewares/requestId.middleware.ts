import { randomUUID } from "crypto";
import { Request, Response, NextFunction } from "express";

declare global {
    namespace Express {
        interface Request {
            /** Correlation id for this request, echoed to the client as X-Request-Id. */
            id: string;
        }
    }
}

/**
 * Gives every request an id and echoes it back as X-Request-Id.
 *
 * This is the join key: nginx can log it via $http_x_request_id, the client can
 * read it off the response header and quote it in a bug report, and every line
 * this process writes about the request carries it. Without one, correlating a
 * user's "it failed at 15:47" against a shared log of many concurrent users is
 * guesswork — which is exactly where the 15 Aug 2026 OTP investigation stalled.
 *
 * An id supplied by the caller is honoured so a client can tie its own failure
 * report to the server's view. Because that value is attacker-controlled it is
 * length-capped and stripped to [A-Za-z0-9._-], so a crafted header cannot
 * embed newlines and forge extra log entries.
 */
export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const supplied = req.headers["x-request-id"];
    const raw = Array.isArray(supplied) ? supplied[0] : supplied;
    const cleaned = raw?.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64);

    req.id = cleaned || randomUUID();
    res.setHeader("X-Request-Id", req.id);
    next();
};
