import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JwtPayload } from "jsonwebtoken";
import { AppError } from '../errors/AppError';
import type { UserRole } from '../utils/generateToken';

const JWT_SECRET = process.env.JWT_PRIVATE_KEY || process.env.JWT_PUBLIC_KEY;

export interface AuthPayload extends JwtPayload {
    sub: string;
    role: UserRole;
    iss: string;
    aud: string;
    iat: number;
    exp: number;
}

declare global {
    namespace Express {
        interface Request {
            auth?: Readonly<AuthPayload>;
        }
    }
}

/**
 * Allows an admin to impersonate a dukandar by passing the
 * X-Impersonate-User-Id header. Must run AFTER authMiddleware.
 * Only honoured when the caller's role is "admin".
 */
export const impersonateMiddleware = (
    req: Request,
    _res: Response,
    next: NextFunction
) => {
    const impersonateId = req.headers['x-impersonate-user-id'] as string | undefined;
    if (req.auth?.role === 'admin' && impersonateId) {
        (req as any).auth = Object.freeze({
            ...req.auth,
            sub: impersonateId,
            role: 'dukandar' as const,
        });
    }
    next();
};

export const authMiddleware = (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        if (!JWT_SECRET) {
            console.error("JWT_SECRET is not configured");
            return res.status(500).json({ message: 'Server configuration error' });
        }

        const authHeader = req.headers.authorization;
        const bearerToken = authHeader?.startsWith("Bearer ")
            ? authHeader.slice(7)
            : undefined;

        const token = bearerToken || req.cookies?.jwt;

        if (!token) {
            throw new AppError("Unauthorized - No token provided", {
                statusCode: 401,
                code: "UNAUTHORIZED",
            });
        }

        let decoded: AuthPayload;
        try {
            decoded = jwt.verify(token, JWT_SECRET, {
                algorithms: ['HS256'],
                issuer: 'gold-khata-book-api',
                audience: 'gold-khata-book-client',
                clockTolerance: 5,
            }) as AuthPayload;
        } catch (jwtError: any) {
            console.error("JWT verification failed:", {
                name: jwtError.name,
                message: jwtError.message,
            });
            return res.status(401).json({
                message: `Invalid or expired token: ${jwtError.message}`
            });
        }

        req.auth = Object.freeze({
            sub: decoded.sub,
            role: decoded.role,
            iss: decoded.iss,
            aud: decoded.aud,
            iat: decoded.iat!,
            exp: decoded.exp!,
        });

        next();
    } catch (err: any) {
        console.error("Unexpected error in authMiddleware:", err);
        return res.status(401).json({ message: 'Authentication failed' });
    }
};