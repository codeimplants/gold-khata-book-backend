import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config({ path: `.env.${process.env.NODE_ENV}` }); // env-specific file on server
dotenv.config(); // fallback to .env for local development

const { NODE_ENV, DEV_DB_URL, PREPROD_DB_URL, PROD_DB_URL } = process.env;

const getMongoURI = (): string => {
    switch (NODE_ENV) {
        case "dev":
            return DEV_DB_URL as string;

        case "preprod":
            return PREPROD_DB_URL as string;

        case "prod":
            return PROD_DB_URL as string;

        default:
            throw new Error(
                "❌ NODE_ENV is not set or has an invalid value (dev | preprod | prod)"
            );
    }
};

const mongoURI = getMongoURI();

if (!mongoURI) {
    throw new Error("❌ MongoDB URI is missing in environment variables");
}

export const connectDB = async (retries = 5): Promise<void> => {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await mongoose.connect(mongoURI, {
                serverSelectionTimeoutMS: 10000,
            });
            console.log(`✅ MongoDB connected successfully [${NODE_ENV}]`);
            return;
        } catch (error: any) {
            console.error(
                `❌ MongoDB connection attempt ${attempt}/${retries} failed:`,
                error.message
            );
            if (attempt === retries) process.exit(1);
            await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
    }
};