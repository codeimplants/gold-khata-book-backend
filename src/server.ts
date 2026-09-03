import express, { Request, Response } from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import { connectDB } from "./config/db";
import modulesRouter from "./modules/routes";
import { notFoundMiddleware } from "./common/middlewares/notFound.middleware";
import { errorMiddleware } from "./common/middlewares/error.middleware";
import { requestIdMiddleware } from "./common/middlewares/requestId.middleware";
import { requestLogMiddleware } from "./common/middlewares/requestLog.middleware";
import { loadGeoIp } from "./common/utils/geoip";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 7100;

// Global override to strip trailing zeroes from toFixed as requested across the app
const originalToFixed = Number.prototype.toFixed;
Number.prototype.toFixed = function (fractionDigits?: number) {
    const formatted = originalToFixed.call(this, fractionDigits);
    return formatted.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
};

// Capacitor origins
const capacitorOrigins = [
    "capacitor://localhost",
    "http://localhost",
    "ionic://localhost",
];

// Development origins
const devOrigins = [
    "http://localhost:8080",
    "http://localhost:8081",
    "http://localhost:8082",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:8080",
    "http://127.0.0.1:8081",
    "http://127.0.0.1:8082",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
];

// Production origins
const prodOrigins = [
    "https://goldkhatabook.codeimplants.com",
    "https://www.goldkhatabook.codeimplants.com",
    "https://goldkhatabook.lovable.app"
];

const allowedOrigins = [
    ...capacitorOrigins,
    ...devOrigins,
    ...prodOrigins,
];

// Both run ahead of CORS so that a request rejected at the CORS boundary still
// gets an id and still appears in the request log — a blocked origin is one of
// the things you most want to see, and it is invisible if logging starts after.
app.use(requestIdMiddleware);
app.use(requestLogMiddleware);

app.use(cors({
    origin: (origin, callback) => {
        // Allow mobile apps & server-to-server calls
        if (!origin) {
            return callback(null, true);
        }

        // Allow known origins
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        // Allow Capacitor / Ionic origins and all localhost/lovable.app variants
        if (
            origin.startsWith("capacitor://") ||
            origin.startsWith("ionic://") ||
            origin.startsWith("http://localhost") ||
            origin.startsWith("https://localhost") ||
            origin.startsWith("http://127.0.0.1") ||
            origin.startsWith("https://127.0.0.1") ||
            origin.endsWith(".lovable.app")
        ) {
            return callback(null, true);
        }

        return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Mutation-Request",
        "x-mutation-request",
        "X-Impersonate-User-Id",
        "X-Requested-With",
        "Accept",
        "Origin",
    ],
    maxAge: 86400, // Cache preflight response for 24 hours
    preflightContinue: false,
    optionsSuccessStatus: 204,
}));


// 1mb, not the 100kb default. A declaration carries the customer's hand-drawn
// signature inline as SVG, capped at INPUT_LIMITS.customerSignature (200 KB) by
// both the schema and the model - so the default would have rejected a signed
// declaration outright with a 413 while the model happily allowed the value.
// Photos never come through here; they are multipart on the upload routes.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(cookieParser());

// Connect to Database
connectDB();

// Optional: absent means shops are stored without a location, nothing else.
// Not awaited — the database is only read once a request arrives, and blocking
// startup on a 130 MB file would delay every restart for a field nobody waits on.
void loadGeoIp().then((ok) => {
    if (ok) {
        console.log("[GeoIP] ✅ City database loaded");
    } else {
        console.warn(
            "[GeoIP] ⚠️  No city database — shops will have no location (see src/common/utils/geoip.ts)"
        );
    }
});

// Routes
app.get("/", (_req: Request, res: Response) => {
    res.json({
        message: "Welcome to the API",
        status: "running",
    });
});

app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// API routes
app.use("/api", modulesRouter);

// 404 handler
app.use(notFoundMiddleware);

// Error handler
app.use(errorMiddleware);

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT} [${process.env.NODE_ENV}] - VERSION: V4-CLEAN`);
});

export default app;
