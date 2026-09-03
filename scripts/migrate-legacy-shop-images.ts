/**
 * One-off migration: move each shop's ImageKit files out of the old shared
 * folder (pre "imagekit changes", commit 2603394) into the per-phone folder
 * the app uses today, then delete the old file so ImageKit doesn't keep two
 * copies around.
 *
 * Old layout: `${env}/${storage}/shopDetails/${category}/{shop_logo|shop_header|signature}_{timestamp}[_].webp`
 *             (one folder SHARED by every shop, per category — see
 *             src/common/utils/imageKit.ts git history before 2603394)
 * New layout: `${env}/${storage}/${phone}/${category}/${category}.webp`
 *             (per-shop folder, overwritten in place on re-upload — see the
 *             current uploadImage() in src/common/utils/imageKit.ts)
 *
 * A shop's stored URL is left untouched if it's already on the new layout,
 * empty, a data: URL, or a drawn <svg> signature string — only genuine
 * ImageKit URLs still on the OLD shared-folder path are migrated.
 *
 * This does not fix any bug: old URLs still resolve fine on their own (the
 * DB stores a full URL, not a path reconstructed from phone+category), so
 * nothing is broken for these shops today. This is purely a storage/tidiness
 * cleanup, matching the "one folder per phone number" convention.
 *
 * Usage (from gold-khata-book-backend/):
 *   NODE_ENV=dev npm run migrate:legacy-shop-images          # dry-run: lists candidates
 *   NODE_ENV=dev npm run migrate:legacy-shop-images -- --apply   # downloads, re-uploads, deletes old file
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config({ path: `.env.${process.env.NODE_ENV}` }); // env-specific file on server
dotenv.config(); // fallback to .env for local development

import imagekit, { uploadImage } from "../src/common/utils/imageKit";

const { NODE_ENV, DEV_DB_URL, PREPROD_DB_URL, PROD_DB_URL, IMAGEKIT_URL_ENDPOINT } = process.env;

const getMongoURI = (): string => {
    switch (NODE_ENV) {
        case "dev": return DEV_DB_URL as string;
        case "preprod": return PREPROD_DB_URL as string;
        case "prod": return PROD_DB_URL as string;
        default: throw new Error("NODE_ENV must be dev | preprod | prod");
    }
};

// Self-contained schema (only the fields this script touches), mirroring
// scripts/seed-admins.ts and scripts/fix-corrupt-shop-images.ts.
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

// "category" exactly as passed to uploadImage() elsewhere (shopDetails.service.ts)
// so the migrated file lands at the identical folder/filename a normal upload would use.
const IMAGE_FIELDS: Array<{ field: "shopLogo" | "shopHeader" | "signature"; category: string }> = [
    { field: "shopLogo", category: "shopLogo" },
    { field: "shopHeader", category: "shopHeader" },
    { field: "signature", category: "signature" },
];

// Strip the ImageKit endpoint origin off a stored URL, returning the
// "folder"/"fileName" shape imagekit.listFiles({ path, name }) expects — the
// same no-leading-slash convention already used by deleteImage() in
// src/common/utils/imageKit.ts. Returns null for anything that isn't a URL on
// our own ImageKit endpoint (empty string, data: URL, <svg> string, etc.)
const toImageKitPath = (url: string): { folder: string; fileName: string } | null => {
    if (!IMAGEKIT_URL_ENDPOINT) return null;
    try {
        const endpoint = new URL(IMAGEKIT_URL_ENDPOINT);
        const target = new URL(url);
        if (target.host !== endpoint.host) return null;

        const basePrefix = endpoint.pathname.replace(/\/$/, ""); // e.g. "/rnjrcg2xw"
        let relative = target.pathname;
        if (basePrefix && relative.startsWith(basePrefix)) {
            relative = relative.slice(basePrefix.length);
        }
        relative = relative.replace(/^\//, "");

        const parts = relative.split("/");
        const fileName = parts.pop();
        if (!fileName) return null;
        return { folder: parts.join("/"), fileName };
    } catch {
        return null;
    }
};

// Only the pre-migration layout has the literal "shopDetails" as its third
// path segment (`${env}/${storage}/shopDetails/${category}`); the current
// layout has the shop's phone number there instead, which can never
// literally spell "shopDetails".
const isLegacyFolder = (folder: string): boolean => folder.split("/")[2] === "shopDetails";

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

    let candidates = 0;
    let migrated = 0;
    let failed = 0;
    let skippedNoPhone = 0;

    for (const shop of shops as any[]) {
        const phone = shop.phone;

        for (const { field, category } of IMAGE_FIELDS) {
            const url = shop[field];
            if (typeof url !== "string" || !/^https?:\/\//i.test(url)) continue; // "", data:, <svg>, etc.

            const parsed = toImageKitPath(url);
            if (!parsed || !isLegacyFolder(parsed.folder)) continue; // already migrated, or not our ImageKit URL

            if (!phone) {
                console.log(`  SKIP ${shop._id} ${field} — legacy file but shop has no phone number: ${url}`);
                skippedNoPhone++;
                continue;
            }

            candidates++;
            console.log(`  ${shop._id} (phone ${phone}) — ${field}: ${url}`);

            if (!apply) continue;

            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
                const buffer = Buffer.from(await res.arrayBuffer());

                const uploadResult = await uploadImage({ buffer }, phone, category);
                await ShopDetail.updateOne({ _id: shop._id }, { $set: { [field]: uploadResult.url } });
                console.log(`    -> migrated to ${uploadResult.url}`);

                // Clean up the old file now that the new one is confirmed in place.
                const oldFiles = await imagekit.listFiles({ path: parsed.folder, name: parsed.fileName });
                for (const f of oldFiles || []) {
                    if (f.fileId) await imagekit.deleteFile(f.fileId);
                }
                console.log(`    -> deleted old file at ${parsed.folder}/${parsed.fileName}`);

                migrated++;
            } catch (err: any) {
                console.error(`    ❌ failed: ${err.message || err}`);
                failed++;
            }
        }
    }

    console.log(
        `\n${apply ? "Migrated" : "Would migrate"} ${apply ? migrated : candidates} field(s)` +
        (skippedNoPhone ? `, skipped ${skippedNoPhone} (no phone number)` : "") +
        (apply && failed ? `, ${failed} failed` : "")
    );
    if (!apply && candidates > 0) {
        console.log("Re-run with `-- --apply` to actually migrate and clean up ImageKit.");
    }

    await mongoose.disconnect();
    process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
    console.error("❌ migrate-legacy-shop-images failed:", err);
    process.exit(1);
});
