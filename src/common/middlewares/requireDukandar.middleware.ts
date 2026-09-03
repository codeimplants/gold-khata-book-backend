import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError";

/**
 * Requires the authenticated user to have the "dukandar" role.
 * Must be used AFTER authMiddleware.
 */
export const requireDukandar = (
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

    if (req.auth.role !== "dukandar") {
        return next(
            new AppError("Forbidden - Dukandar access required", {
                statusCode: 403,
                code: "FORBIDDEN",
            })
        );
    }

    next();
};

/**
 * Requires the authenticated user to have the "customer" role.
 * Must be used AFTER authMiddleware.
 */
export const requireCustomer = (
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

    if (req.auth.role !== "customer") {
        return next(
            new AppError("Forbidden - Customer access required", {
                statusCode: 403,
                code: "FORBIDDEN",
            })
        );
    }

    next();
};
