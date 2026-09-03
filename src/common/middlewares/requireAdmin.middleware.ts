import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError";

/**
 * Requires the authenticated user to have the "admin" role.
 * Must be used AFTER authMiddleware.
 */
export const requireAdmin = (
    req: Request,
    _res: Response,
    next: NextFunction
) => {
    if (!req.auth) {
        return next(
            new AppError("Unauthorized - Not authenticated", {
                statusCode: 401,
                code: "UNAUTHORIZED",
            })
        );
    }

    if (req.auth.role !== "admin") {
        return next(
            new AppError("Forbidden - Admin access required", {
                statusCode: 403,
                code: "FORBIDDEN",
            })
        );
    }

    next();
};
