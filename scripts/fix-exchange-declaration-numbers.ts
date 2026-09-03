/**
 * Re-points exchange declarations at their bill's number.
 *
 *   NODE_ENV=prod npx ts-node scripts/fix-exchange-declaration-numbers.ts          # dry run
 *   NODE_ENV=prod npx ts-node scripts/fix-exchange-declaration-numbers.ts --apply  # writes
 *
 * Written 2026-08-26, alongside the change that stops exchange declarations
 * drawing a POG-n from the shop's standalone counter and gives them their
 * bill's own number instead (INV-49, ADV-83).
 *
 * Only records written before that change need this. There were five in
 * production, one of them belonging to a shop that no longer exists.
 *
 * The reason it cannot simply be skipped: the printed declaration now labels
 * that field "Bill No." for an exchange, so a record still holding POG-2 would
 * print "Bill No.: POG-2" — a wrong statement on a signed legal document.
 *
 * Safe with respect to photographs. `declarationNumber` composes the ImageKit
 * folder only at upload time; the record stores {url, fileId} and reads use the
 * stored url. Renaming moves nothing and breaks no existing image — it only
 * means any photo added later lands in a folder named after the bill.
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

(async () => {
  await mongoose.connect(getMongoURI());
  const db = mongoose.connection.db!;

  // Live exchange declarations still holding a standalone serial.
  const stale = await db.collection("purchaseOldGold")
    .find({ mode: "exchange", deletedAt: null, declarationNumber: { $regex: "^POG-" } })
    .toArray();

  console.log(`\n=== ${NODE_ENV} — exchange declarations holding a POG-n: ${stale.length} ===`);
  console.log(APPLY ? "MODE: APPLY (writing)\n" : "MODE: DRY RUN (no writes)\n");

  let fixed = 0;
  let skipped = 0;

  for (const rec of stale) {
    // Deliberately no `deletedAt: null`. A soft-deleted bill is in the trash,
    // not gone — it is restorable for 30 days, and its number is still the
    // number this declaration belongs to. One of the five in production is in
    // exactly that state: INV-49 was trashed on 24 Aug while its declaration
    // stayed live. Scoped to the shop, so a declaration can never take a
    // number from another dukandar's bill.
    const filter = { _id: rec.orderId, userId: rec.userId };
    const invoice = rec.orderId ? await db.collection("invoices").findOne(filter) : null;
    const order = invoice ? null : rec.orderId ? await db.collection("orders").findOne(filter) : null;
    const billNumber = (invoice as any)?.invoiceNumber || (order as any)?.orderNumber;

    if (!billNumber) {
      // The 8 Aug record is here: its shop was deleted and the bill it names is
      // gone, so there is no number to take. Left exactly as it is — inventing
      // one would be worse than an out-of-date one nobody can see.
      console.log(`  SKIP  ${rec.declarationNumber}  — bill not found (orderId ${rec.orderId ?? "none"})`);
      skipped += 1;
      continue;
    }

    // Would two declarations end up sharing a number? Zero in production, but
    // this is the check that makes running it elsewhere safe.
    const clash = await db.collection("purchaseOldGold").findOne({
      _id: { $ne: rec._id },
      userId: rec.userId,
      deletedAt: null,
      declarationNumber: billNumber,
    });
    if (clash) {
      console.log(`  SKIP  ${rec.declarationNumber}  — ${billNumber} is already taken by ${clash._id}`);
      skipped += 1;
      continue;
    }

    console.log(`  ${APPLY ? "FIX " : "WOULD"}  ${rec.declarationNumber}  ->  ${billNumber}`);

    if (APPLY) {
      await db.collection("purchaseOldGold").updateOne(
        { _id: rec._id },
        { $set: { declarationNumber: billNumber } }
      );
    }
    fixed += 1;
  }

  console.log(`\n${APPLY ? "updated" : "would update"}: ${fixed}   skipped: ${skipped}\n`);
  if (!APPLY && fixed > 0) console.log("Re-run with --apply to write.\n");

  await mongoose.disconnect();
})().catch(async e => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
