/**
 * Removes rows belonging to shops that no longer exist.
 *
 *   NODE_ENV=prod npx ts-node scripts/purge-orphaned-shop-data.ts          # dry run
 *   NODE_ENV=prod npx ts-node scripts/purge-orphaned-shop-data.ts --apply  # writes
 *
 * Written 2026-08-26, the backfill half of completing
 * DukandarService.hardDeleteWithCascade. The cascade now removes every per-shop
 * collection; this clears what earlier, narrower versions of it left behind.
 *
 * In production before this ran: 100 of 104 catalogue products belonged to
 * shops that no longer existed, alongside 4 customers, 2 invoices, 2
 * declarations and 1 shop-details row.
 *
 * A row is removed only when the shop id it names matches no dukandar. That is
 * a fact about the database, not a judgement: the owning account is gone, no
 * API can reach the row again, and nothing can ever attribute it to anyone.
 *
 * THE ONE THING THAT WOULD MAKE THIS CATASTROPHIC is a bad read of the shop
 * list — if `dukandars` came back empty, every row on the platform would look
 * orphaned. So the run aborts below a plausible number of shops, and prints
 * what it would delete before deleting anything.
 *
 * Deliberately NOT touched:
 *   - rows whose owner field is missing entirely, since "no owner recorded" is
 *     a different problem from "owner deleted" and deserves to be looked at
 *     rather than swept up;
 *   - anything platform-level: admins, tutorials, platform config, and the
 *     deleted-user log, which is the record OF deletions and must outlive them.
 *
 * Dry run by default. Pass --apply to write.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config({ path: `.env.${process.env.NODE_ENV}` });
dotenv.config();

const { NODE_ENV, DEV_DB_URL, PREPROD_DB_URL, PROD_DB_URL } = process.env;

const getMongoURI = (): string => {
  switch (NODE_ENV) {
    case "dev": return DEV_DB_URL as string;
    case "preprod": return PREPROD_DB_URL as string;
    case "prod": return PROD_DB_URL as string;
    default: throw new Error("NODE_ENV must be dev | preprod | prod");
  }
};

const APPLY = process.argv.includes("--apply");

/** Below this, assume the shop read failed rather than that the platform emptied. */
const MIN_PLAUSIBLE_SHOPS = 5;

/** Every per-shop collection, and the field naming its owner. */
const OWNED: { collection: string; owner: string }[] = [
  { collection: "shopdetails",     owner: "userId" },
  { collection: "customers",       owner: "dukandarId" },
  { collection: "invoices",        owner: "userId" },
  { collection: "orders",          owner: "userId" },
  { collection: "purchaseOldGold", owner: "userId" },
  { collection: "catalogproducts", owner: "dukandarId" },
  { collection: "purchases",       owner: "userId" },
  { collection: "items",           owner: "dukandarId" },
  { collection: "metalrates",      owner: "dukandarId" },
  { collection: "communications",  owner: "dukandarId" },
  { collection: "appopenlogs",     owner: "dukandarId" },
];

(async () => {
  await mongoose.connect(getMongoURI());
  const db = mongoose.connection.db!;

  const shops = await db.collection("dukandars").find({}, { projection: { _id: 1 } }).toArray();
  const live = new Set(shops.map(s => String(s._id)));

  if (live.size < MIN_PLAUSIBLE_SHOPS) {
    console.error(
      `\nABORT: only ${live.size} shops found. Every row would look orphaned, which is far ` +
      `more likely to be a failed read than a real state. Nothing written.\n`
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  const present = new Set((await db.listCollections().toArray()).map(c => c.name));

  console.log(`\n=== ${NODE_ENV} — rows owned by shops that no longer exist ===`);
  console.log(APPLY ? "MODE: APPLY (writing)\n" : "MODE: DRY RUN (no writes)\n");
  console.log(`live shops: ${live.size}\n`);

  let grandTotal = 0;

  for (const { collection, owner } of OWNED) {
    if (!present.has(collection)) {
      console.log(`  ${collection.padEnd(18)} (collection does not exist)`);
      continue;
    }

    const rows = await db.collection(collection)
      .find({}, { projection: { [owner]: 1 } })
      .toArray();

    const orphanIds = rows
      .filter(r => {
        const v = (r as any)[owner];
        return v && !live.has(String(v));
      })
      .map(r => r._id);

    const noOwner = rows.filter(r => !(r as any)[owner]).length;

    console.log(
      `  ${collection.padEnd(18)} total=${String(rows.length).padStart(5)}  ` +
      `orphaned=${String(orphanIds.length).padStart(5)}` +
      (noOwner ? `  (${noOwner} with no owner field, left alone)` : "")
    );

    grandTotal += orphanIds.length;

    if (APPLY && orphanIds.length) {
      const res = await db.collection(collection).deleteMany({ _id: { $in: orphanIds } });
      console.log(`  ${"".padEnd(18)} deleted ${res.deletedCount}`);
    }
  }

  console.log(`\n${APPLY ? "total deleted" : "total that would be deleted"}: ${grandTotal}`);
  if (!APPLY && grandTotal > 0) console.log("Re-run with --apply to write.");
  console.log("");

  await mongoose.disconnect();
})().catch(async e => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
