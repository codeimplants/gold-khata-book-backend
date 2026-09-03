import { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError";

export const blockImpersonatedWrites = (req: Request, _res: Response, next: NextFunction) => {
    if (req.headers["x-impersonate-user-id"] && req.method !== "GET") {
        throw new AppError("Write operations are not allowed during admin impersonation", {
            statusCode: 403,
            code: "FORBIDDEN",
        });
    }
    next();
};
