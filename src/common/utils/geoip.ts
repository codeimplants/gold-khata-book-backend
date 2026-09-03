import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Request } from "express";

/**
 * Coarse location from the request IP.
 *
 * Deliberately offline. The obvious alternative — calling ip-api.com or
 * ipinfo.io per login — would send every shop's IP address to a third party,
 * which is a disclosure obligation and a dependency on someone else's uptime
 * for a field nobody would miss. A local database answers in microseconds and
 * tells no one.
 *
 * Optional by design: with no database file present, lookups return null and
 * login carries on. Nothing here may become a reason a shop cannot sign in.
 *
 * Any MMDB-format city database works. Currently db-ip's City Lite:
 *   https://db-ip.com/db/download/ip-to-city-lite
 * Chosen over MaxMind's GeoLite2 because it needs no account or licence key, so
 * the refresh job can fetch it unattended — see scripts/refresh-geoip.sh. It is
 * CC-BY 4.0, so it requires attribution wherever the data is surfaced.
 *
 * The file is gitignored: it is ~130 MB, and a monthly-changing binary blob is
 * exactly what git is worst at.
 *
 * This mirrors goldrate-backend's service of the same name. Kept as a copy
 * rather than a shared package because the two differ only in their web
 * framework, and the shared surface — two dozen lines around one library call —
 * is smaller than the dependency it would take to unify them.
 */

const DB_PATH = resolve(process.env.GEOIP_DB_FILE || "./data/city.mmdb");

export interface GeoLocation {
    city: string | null;
    region: string | null;
    country: string | null;
}

export const EMPTY_LOCATION: GeoLocation = { city: null, region: null, country: null };

type Reader = { get(ip: string): unknown };

let reader: Reader | null = null;
let available = false;

/**
 * Loads the database once at boot. Never throws: an absent or unreadable file
 * simply disables the feature.
 */
export async function loadGeoIp(): Promise<boolean> {
    try {
        // Imported lazily so the dependency is only resolved when the file
        // exists — the service still starts on a box where it was never
        // installed.
        const { Reader: MaxmindReader } = await import("maxmind");
        const buffer = await readFile(DB_PATH);
        reader = new MaxmindReader(buffer) as Reader;
        available = true;
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        // MODULE_NOT_FOUND is the CommonJS spelling of ERR_MODULE_NOT_FOUND;
        // this build compiles to CJS, so the dynamic import becomes a require.
        if (code !== "ENOENT" && code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") {
            console.warn(`[GeoIP] ⚠️  Could not load ${DB_PATH}: ${(err as Error).message}`);
        }
        reader = null;
        available = false;
    }

    return available;
}

export function geoIpAvailable(): boolean {
    return available;
}

/**
 * The client's address, as seen through nginx.
 *
 * X-Forwarded-For is a list, appended to by each proxy, and only the entries
 * added by proxies we control can be trusted. nginx appends the real peer last,
 * so the LAST entry is ours and the earlier ones are whatever the client chose
 * to send. Taking the first — the usual mistake — lets any caller set their own
 * location by sending the header themselves.
 *
 * Reads the header directly instead of turning on Express's `trust proxy`.
 * That setting rewrites `req.ip` process-wide, and this app's request logging
 * and error handling already read it; changing what it means everywhere, to
 * populate one optional field, is a far wider blast radius than this is worth.
 */
export function clientIp(req: Request): string | null {
    const header = req.headers["x-forwarded-for"];
    const raw = Array.isArray(header) ? header[header.length - 1] : header;

    if (typeof raw === "string" && raw.trim() !== "") {
        const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
        if (parts.length > 0) return parts[parts.length - 1];
    }

    return req.socket?.remoteAddress || null;
}

/** Never throws; unknown addresses and private ranges resolve to nulls. */
export function lookup(ip: string | null): GeoLocation {
    if (!reader || !ip) return EMPTY_LOCATION;

    try {
        const result = reader.get(ip) as
            | {
                city?: { names?: Record<string, string> };
                subdivisions?: { names?: Record<string, string> }[];
                country?: { iso_code?: string };
            }
            | null;

        if (!result) return EMPTY_LOCATION;

        return {
            city: result.city?.names?.en ?? null,
            region: result.subdivisions?.[0]?.names?.en ?? null,
            country: result.country?.iso_code ?? null,
        };
    } catch {
        return EMPTY_LOCATION;
    }
}

/** Convenience: resolve straight from a request. */
export function locate(req: Request): GeoLocation {
    return lookup(clientIp(req));
}

/** What is stored on a user: a lookup plus when it was taken. */
export interface StoredLocation extends GeoLocation {
    updatedAt: Date;
}

/**
 * Fold a fresh lookup onto whatever is already stored.
 *
 * Field by field rather than by spreading, for two reasons. A failed lookup
 * returns nulls, and writing those would erase a location already known —
 * turning one request over a VPN, or one made while the database file was being
 * replaced, into permanent data loss. And `existing` arrives as a Mongoose
 * subdocument, whose paths live on the prototype: `{ ...subdoc }` copies its
 * internals and none of its values, so a spread here would silently store an
 * object with no city in it.
 *
 * Returns null when the result would hold nothing, so callers can skip the
 * write entirely rather than stamping updatedAt on an empty record.
 */
export function mergeLocation(
    existing: Partial<GeoLocation> | null | undefined,
    fresh: GeoLocation,
): StoredLocation | null {
    const city = fresh.city ?? existing?.city ?? null;
    const region = fresh.region ?? existing?.region ?? null;
    const country = fresh.country ?? existing?.country ?? null;

    if (!city && !region && !country) return null;

    return { city, region, country, updatedAt: new Date() };
}
