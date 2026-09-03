/**
 * Removes per-shop numbering counters belonging to shops that no longer exist.
 *
 *   NODE_ENV=prod npx ts-node scripts/purge-orphaned-counters.ts          # dry run
 *   NODE_ENV=prod npx ts-node scripts/purge-orphaned-counters.ts --apply  # writes
 *
 * Written 2026-08-26, the backfill half of the counter cleanup added to
 * DukandarService.hardDeleteWithCascade. That stops new ones accumulating;
 * this clears what is already there — 138 rows across 99 vanished shops in
 * production, against 71 belonging to the 44 live ones.
 *
 * Each shop gets its own sequences: customer_<id>, invoice_<id>, order_<id>
 * and purchaseOldGold_<id>. Deleting the shop never removed them, so they sit
 * in the collection unreadable by anything: a phone that re-registers is a new
 * ObjectId and never addresses the old rows.
 *
 * WHAT MAKES THIS SAFE, and what would make it catastrophic:
 *
 * A counter is deleted only when the ObjectId in its own name matches no
 * dukandar. Delete a LIVE shop's invoice counter and the sequence restarts at
 * 1, so the shop reissues invoice numbers it has already given to customers —
 * duplicate INV-1, INV-2 on real bills, with no way to tell them apart after
 * the fact. Every guard below exists for that one outcome:
 *
 *   - the global "orders" counter, shared by every shop for ADV numbering, has
 *     no _<oid> suffix and can never match the pattern;
 *   - a name whose suffix is not exactly 24 hex characters is left alone;
 *   - and the run aborts entirely if the dukandars collection comes back empty
 *     or improbably small, since a failed read would otherwise make every
 *     counter on the platform look orphaned.
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

(async () => {
  await mongoose.connect(getMongoURI());
  const db = mongoose.connection.db!;

  const shops = await db.collection("dukandars").find({}, { projection: { _id: 1 } }).toArray();
  const liveIds = new Set(shops.map(s => String(s._id)));

  if (liveIds.size < MIN_PLAUSIBLE_SHOPS) {
    console.error(
      `\nABORT: only ${liveIds.size} shops found. Every counter would look orphaned, ` +
      `which is far more likely to be a failed read than a real state. Nothing written.\n`
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  const counters = await db.collection("counters").find({}).toArray();

  const orphans: { id: string; seq: number }[] = [];
  let kept = 0;
  let globals = 0;

  for (const c of counters) {
    const name = String(c.id);
    const match = /^(.+)_([0-9a-f]{24})$/.exec(name);
    if (!match) {
      // "orders" lands here — global, shared by every shop, never touched.
      globals += 1;
      continue;
    }
    if (liveIds.has(match[2])) { kept += 1; continue; }
    orphans.push({ id: name, seq: c.seq });
  }

  console.log(`\n=== ${NODE_ENV} — counters ===`);
  console.log(APPLY ? "MODE: APPLY (writing)\n" : "MODE: DRY RUN (no writes)\n");
  console.log(`  live shops                 : ${liveIds.size}`);
  console.log(`  counters total             : ${counters.length}`);
  console.log(`  kept (live shop)           : ${kept}`);
  console.log(`  kept (global, no shop id)  : ${globals}`);
  console.log(`  orphaned                   : ${orphans.length}`);

  const byPrefix = new Map<string, number>();
  orphans.forEach(o => {
    const p = o.id.replace(/_[0-9a-f]{24}$/, "");
    byPrefix.set(p, (byPrefix.get(p) ?? 0) + 1);
  });
  console.log(`\n  orphans by kind:`);
  [...byPrefix.entries()].sort().forEach(([k, v]) => console.log(`    ${k.padEnd(20)} ${v}`));

  if (APPLY && orphans.length) {
    const result = await db.collection("counters").deleteMany({ id: { $in: orphans.map(o => o.id) } });
    console.log(`\n  deleted: ${result.deletedCount}`);
  } else if (orphans.length) {
    console.log(`\n  would delete: ${orphans.length}`);
    console.log(`  Re-run with --apply to write.`);
  }

  console.log("");
  await mongoose.disconnect();
})().catch(async e => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
