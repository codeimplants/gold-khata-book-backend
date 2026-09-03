/**
 * Retires exchange declarations whose bill no longer exists.
 *
 *   NODE_ENV=prod npx ts-node scripts/retire-orphaned-declarations.ts          # dry run
 *   NODE_ENV=prod npx ts-node scripts/retire-orphaned-declarations.ts --apply  # writes
 *
 * Written 2026-08-26, the backfill half of the fix in
 * common/utils/declarationLifecycle.ts. That stops new orphans being made;
 * this clears the ones already there.
 *
 * An exchange declaration points at a bill by orderId. Permanently deleting a
 * bill used to remove the invoice and its items and leave the declaration
 * behind, live. Since exchange declarations are no longer listed under Sold to
 * Us — they belong to their bill and are opened from it — a live declaration
 * whose bill is gone is reachable from nowhere at all. It sits in the
 * collection, counts towards nothing, and can be opened by no one.
 *
 * Soft, never hard, exactly as retireDeclarationFor and
 * PurchaseOldGoldService.remove leave one: a signed declaration is the shop's
 * legal record of who sold them gold. This sets deletedAt so it stops being
 * live; it does not destroy evidence.
 *
 * Deliberately NOT retired:
 *   - standalone declarations, which have no bill and cannot be orphaned;
 *   - declarations whose bill is merely trashed (deletedAt set). That is a
 *     30-day bin, the bill can come back, and its declaration has to be
 *     waiting when it does. Only a bill that is genuinely absent counts.
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

  const live = await db.collection("purchaseOldGold")
    .find({ mode: "exchange", deletedAt: null })
    .toArray();

  console.log(`\n=== ${NODE_ENV} — live exchange declarations: ${live.length} ===`);
  console.log(APPLY ? "MODE: APPLY (writing)\n" : "MODE: DRY RUN (no writes)\n");

  let retired = 0;
  let kept = 0;

  for (const rec of live) {
    // No deletedAt filter: a trashed bill still exists and still counts.
    const filter = { _id: rec.orderId, userId: rec.userId };
    const bill = rec.orderId
      ? (await db.collection("invoices").findOne(filter)) ||
        (await db.collection("orders").findOne(filter))
      : null;

    if (bill) {
      const trashed = (bill as any).deletedAt ? " (trashed, kept on purpose)" : "";
      console.log(`  KEEP  ${rec.declarationNumber}  — bill exists${trashed}`);
      kept += 1;
      continue;
    }

    console.log(
      `  ${APPLY ? "RETIRE" : "WOULD"}  ${rec.declarationNumber}  ` +
      `— no bill at ${rec.orderId ?? "(no orderId)"}`
    );

    if (APPLY) {
      await db.collection("purchaseOldGold").updateOne(
        { _id: rec._id },
        { $set: { deletedAt: new Date() } }
      );
    }
    retired += 1;
  }

  console.log(`\n${APPLY ? "retired" : "would retire"}: ${retired}   kept: ${kept}\n`);
  if (!APPLY && retired > 0) console.log("Re-run with --apply to write.\n");

  await mongoose.disconnect();
})().catch(async e => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
