/**
 * One-off cleanup: purge corrupt shop image values from the DB.
 *
 * Background: shopLogo / shopHeader / signature are String columns. An older code
 * path let a JS object reach Mongoose, which cast it to the literal string
 * "[object Object]" — rendering as a broken image on the web. This script finds
 * such corrupt values and clears them to "" so the UI shows "no image" and the
 * user can re-upload. (A successful ImageKit upload always yields a real URL, so
 * a corrupt value was never uploaded — there is nothing to recover.)
 *
 * Usage (from gold-khata-book-backend/):
 *   NODE_ENV=dev npm run fix:shop-images          # dry-run: lists what would change
 *   NODE_ENV=dev npm run fix:shop-images -- --apply   # actually clears the fields
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config({ path: `.env.${process.env.NODE_ENV}` }); // env-specific file on server
dotenv.config(); // fallback to .env for local development

const { NODE_ENV, DEV_DB_URL, PREPROD_DB_URL, PROD_DB_URL } = process.env;

// Self-contained schema (only the fields this script touches) so it can run
// standalone via ts-node without pulling the app's models, mirroring
// scripts/seed-admins.ts. Targets the same "ShopDetails" collection.
const ShopDetailSchema = new mongoose.Schema(
    {
        phone: { type: Number },
        shopLogo: { type: String },
        shopHeader: { type: String },
        signature: { type: String },
    },
    { strict: false, versionKey: false }
);
const ShopDetail =
    mongoose.models.ShopDetails || mongoose.model("ShopDetails", ShopDetailSchema);

const getMongoURI = (): string => {
    switch (NODE_ENV) {
        case "dev": return DEV_DB_URL as string;
        case "preprod": return PREPROD_DB_URL as string;
        case "prod": return PROD_DB_URL as string;
        default: throw new Error("NODE_ENV must be dev | preprod | prod");
    }
};

const IMAGE_FIELDS = ["shopLogo", "shopHeader", "signature"] as const;

// A value is a valid image reference if it's empty or looks like a real
// image source. Anything else (notably "[object Object]") is corrupt.
const isValidImageValue = (value: unknown): boolean => {
    if (typeof value !== "string") return false; // Mongoose returns strings, but be safe
    const v = value.trim();
    if (v === "") return true; // empty = "no image", fine
    return (
        v.startsWith("http://") ||
        v.startsWith("https://") ||
        v.startsWith("data:") ||
        v.startsWith("/") ||
        v.startsWith("<svg")
    );
};

async function run() {
    const apply = process.argv.includes("--apply");

    const uri = getMongoURI();
    if (!uri) throw new Error("MongoDB URI is missing in environment variables");

    await mongoose.connect(uri);
    console.log(`✅ Connected [${NODE_ENV}]${apply ? " — APPLY mode" : " — DRY RUN"}`);

    const shops = await ShopDetail.find(
        {},
        { phone: 1, shopLogo: 1, shopHeader: 1, signature: 1 }
    ).lean();

    let affectedDocs = 0;
    let affectedFields = 0;

    for (const shop of shops as any[]) {
        const bad: string[] = [];
        for (const field of IMAGE_FIELDS) {
            const value = shop[field];
            // Only flag fields that are actually set but invalid (leave undefined alone).
            if (value !== undefined && value !== null && !isValidImageValue(value)) {
                bad.push(field);
                console.log(
                    `  ${shop._id} (phone ${shop.phone ?? "?"}) — ${field} = ${JSON.stringify(value)}`
                );
            }
        }

        if (bad.length === 0) continue;
        affectedDocs++;
        affectedFields += bad.length;

        if (apply) {
            const $set: Record<string, string> = {};
            for (const field of bad) $set[field] = "";
            await ShopDetail.updateOne({ _id: shop._id }, { $set });
        }
    }

    console.log(
        `\n${apply ? "Cleared" : "Would clear"} ${affectedFields} field(s) across ${affectedDocs} shop(s).`
    );
    if (!apply && affectedFields > 0) {
        console.log("Re-run with `-- --apply` to make these changes.");
    }

    await mongoose.disconnect();
    process.exit(0);
}

run().catch((err) => {
    console.error("❌ fix-corrupt-shop-images failed:", err);
    process.exit(1);
});
