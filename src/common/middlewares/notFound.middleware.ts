import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError";

export const notFoundMiddleware = (
    _req: Request,
    _res: Response,
    next: NextFunction
) => {
    next(
        new AppError("Route not found", {
            statusCode: 404,
            code: "NOT_FOUND",
        })
    );
};