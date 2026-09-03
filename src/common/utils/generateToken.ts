import jwt from "jsonwebtoken";
import mongoose from "mongoose";

export type UserRole = "admin" | "dukandar" | "customer";

export const generateToken = (userId: mongoose.Types.ObjectId, role: UserRole) => {
    return jwt.sign(
        {
            sub: userId,
            role,
            iss: "gold-khata-book-api",
            aud: "gold-khata-book-client",
        },
        process.env.JWT_PRIVATE_KEY!,
        {
            algorithm: "HS256",
            expiresIn: "1y",
        }
    );
};
