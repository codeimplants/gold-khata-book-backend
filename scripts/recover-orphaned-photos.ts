/**
 * Re-attaches photos that reached ImageKit but never reached the database.
 *
 *   NODE_ENV=prod npx ts-node scripts/recover-orphaned-photos.ts 9850929690
 *   NODE_ENV=prod npx ts-node scripts/recover-orphaned-photos.ts 9850929690 --apply
 *
 * Read-only without --apply.
 *
 * Why this exists: photo uploads used to be written with doc.save(), which
 * carries Mongoose optimistic concurrency on a modified array. The client fires
 * the ornament and the item uploads together and each spends seconds in
 * ImageKit before writing, so both loaded the record at the same __v, the first
 * commit bumped it, and the second was rejected with "No matching document
 * found ... version 0". The files were already in ImageKit by then; only the
 * reference was lost, and silently, because nothing read the failed indices.
 *
 * Fixed at source on 2026-08-23 (atomic $set per path). This recovers what was
 * dropped before that shipped. INV-7, INV-8 and one advance order are known to
 * be affected for shop 9850929690.
 *
 * Safe to re-run: a file already referenced in the record is skipped, so it
 * cannot duplicate a photo. Ordered by ImageKit's createdAt so recovered photos
 * appear in the order they were taken.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config({ path: `.env.${process.env.NODE_ENV}` });
dotenv.config();
import ImageKit from "imagekit";

const { NODE_ENV, DEV_DB_URL, PREPROD_DB_URL, PROD_DB_URL } = process.env;

const getMongoURI = (): string => {
  switch (NODE_ENV) {
    case "dev": return DEV_DB_URL as string;
    case "preprod": return PREPROD_DB_URL as string;
    case "prod": return PROD_DB_URL as string;
    default: throw new Error("NODE_ENV must be dev | preprod | prod");
  }
};

const ik = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY as string,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY as string,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT as string,
});

const APP = process.env.IMAGEKIT_STORAGE_APP;
const phoneArg = process.argv[2];
const APPLY = process.argv.includes("--apply");

if (!phoneArg) throw new Error("usage: recover-orphaned-photos.ts <shopPhone> [--apply]");
const phone = Number(phoneArg);

/** Files ImageKit holds under one folder, oldest first. */
const listFolder = async (path: string): Promise<{ fileId: string; url: string; createdAt: string }[]> => {
  try {
    const files: any[] = await (ik as any).listFiles({ path, limit: 100 });
    return files
      .map(f => ({ fileId: f.fileId, url: f.url, createdAt: f.createdAt }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
};

/**
 * Photos on the record that ImageKit does not know about are left alone: this
 * only ever adds a reference back, never removes one.
 */
const missingFrom = (
  stored: { fileId?: string }[] | undefined,
  found: { fileId: string; url: string }[],
) => {
  const known = new Set((stored || []).map(p => p.fileId).filter(Boolean));
  return found.filter(f => !known.has(f.fileId));
};

(async () => {
  await mongoose.connect(getMongoURI());
  const db = mongoose.connection.db!;

  const shop = await db.collection("dukandars").findOne({ phone });
  if (!shop) { console.log("no shop for phone", phone); await mongoose.disconnect(); return; }

  console.log(`\n=== ${NODE_ENV} / shop ${phone} / ${APPLY ? "APPLY" : "dry run"} ===`);

  const targets = [
    { coll: "invoices", section: "invoices", numberField: "invoiceNumber" },
    { coll: "orders", section: "orders", numberField: "orderNumber" },
  ];

  let recovered = 0;

  for (const t of targets) {
    const records = await db.collection(t.coll)
      .find({ userId: shop._id, deletedAt: null })
      .toArray();

    for (const rec of records as any[]) {
      const ref = rec[t.numberField] || String(rec._id);
      const base = `${NODE_ENV}/${APP}/${phone}/${t.section}/${ref}`;
      const updates: Record<string, any[]> = {};
      const lines: string[] = [];

      // Item photos, one folder per index.
      for (let i = 0; i < (rec.items || []).length; i++) {
        const found = await listFolder(`${base}/items/${i}`);
        if (found.length === 0) continue;
        const missing = missingFrom(rec.items[i]?.photos, found);
        if (missing.length === 0) continue;
        updates[`items.${i}.photos`] = [
          ...(rec.items[i]?.photos || []),
          ...missing.map(f => ({ url: f.url, fileId: f.fileId })),
        ];
        lines.push(`    item[${i}] "${rec.items[i]?.name ?? ""}": +${missing.length}`);
      }

      // Exchange photos, same shape.
      for (let i = 0; i < (rec.ornamentExchanges || []).length; i++) {
        const found = await listFolder(`${base}/exchanges/${i}`);
        if (found.length === 0) continue;
        const missing = missingFrom(rec.ornamentExchanges[i]?.photos, found);
        if (missing.length === 0) continue;
        updates[`ornamentExchanges.${i}.photos`] = [
          ...(rec.ornamentExchanges[i]?.photos || []),
          ...missing.map(f => ({ url: f.url, fileId: f.fileId })),
        ];
        lines.push(`    exchange[${i}] "${rec.ornamentExchanges[i]?.itemName ?? ""}": +${missing.length}`);
      }

      // The bill-wide set sits directly in the record folder. Anything in there
      // that is not already referenced belongs to it.
      const rootFound = await listFolder(base);
      const rootMissing = missingFrom(rec.ornamentPhotos, rootFound);
      if (rootMissing.length > 0) {
        updates["ornamentPhotos"] = [
          ...(rec.ornamentPhotos || []),
          ...rootMissing.map(f => ({ url: f.url, fileId: f.fileId })),
        ];
        lines.push(`    ornamentPhotos: +${rootMissing.length}`);
      }

      if (lines.length === 0) continue;

      console.log(`\n  ${ref}  (${t.coll}/${rec._id})`);
      lines.forEach(l => console.log(l));
      recovered += lines.length;

      if (APPLY) {
        await db.collection(t.coll).updateOne({ _id: rec._id }, { $set: updates });
        console.log("    -> written");
      }
    }
  }

  console.log(
    recovered === 0
      ? "\nNothing orphaned."
      : `\n${recovered} group(s) ${APPLY ? "recovered" : "recoverable — re-run with --apply"}.`,
  );

  await mongoose.disconnect();
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
