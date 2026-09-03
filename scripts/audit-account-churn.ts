/**
 * READ-ONLY: who deleted their account and signed up again, and how exposed the
 * catalogue is to the autofill trap that made one of them do it four times.
 *
 *   NODE_ENV=prod npx ts-node scripts/audit-account-churn.ts
 *
 * Written 2026-08-18. Shop 9231531962 reported "gross weight 8.075 was not
 * working, so I deleted my account and created it again". The cause was a saved
 * catalogue item clearing the typed gross weight — every numeric field on a
 * catalogue product is `default: 0`, and a stored 0 was treated as a real value
 * that overwrote what had been typed. Deleting the account "fixes" it because
 * it deletes the catalogue too.
 *
 * That shop deleted four times and lost 27 invoices doing it. This asks how
 * many others are in the same position, and how many catalogues carry the 0
 * that springs the trap.
 *
 * Writes nothing.
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

const EXCLUDE = Number(process.argv[2] ?? 9231531962);
const d = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "-"));

(async () => {
  await mongoose.connect(getMongoURI());
  const db = mongoose.connection.db!;

  const logs = await db.collection("deleteduserlogs").find({}).sort({ deletedAt: 1 }).toArray();
  const live = await db.collection("dukandars").find({}, { projection: { phone: 1, createdAt: 1 } }).toArray();
  const livePhones = new Map(live.map(u => [Number(u.phone), u]));

  const byPhone = new Map<number, any[]>();
  logs.forEach(l => {
    const p = Number(l.phone);
    if (!byPhone.has(p)) byPhone.set(p, []);
    byPhone.get(p)!.push(l);
  });

  console.log(`\n=== ${NODE_ENV} — account churn ===`);
  console.log(`live accounts            : ${live.length}`);
  console.log(`deletion events          : ${logs.length}`);
  console.log(`distinct phones deleted  : ${byPhone.size}`);
  console.log(`  self-deleted           : ${logs.filter(l => l.deletionReason === "self").length}`);
  console.log(`  admin (manual/bulk)    : ${logs.filter(l => l.deletionReason !== "self").length}`);

  // Recreated = deleted at least once, and has a live account again today.
  const recreated = [...byPhone.entries()]
    .filter(([phone, entries]) => livePhones.has(phone) && entries.some(e => e.deletionReason === "self"))
    .sort((a, b) => b[1].length - a[1].length);

  const others = recreated.filter(([phone]) => phone !== EXCLUDE);

  console.log(`\n--- deleted their own account AND signed up again: ${recreated.length} shops ---`);
  console.log(`    (excluding ${EXCLUDE}: ${others.length})\n`);

  recreated.forEach(([phone, entries]) => {
    const selfDeletes = entries.filter(e => e.deletionReason === "self");
    const lostInvoices = entries.reduce((s, e) => s + (e.totalInvoices || 0), 0);
    const lostValue = entries.reduce((s, e) => s + (e.totalSalesValue || 0), 0);
    const tag = phone === EXCLUDE ? "  <- the reported shop" : "";
    console.log(
      `${phone}  deletions=${entries.length} (self ${selfDeletes.length})  ` +
      `invoices lost=${lostInvoices}  value lost=${Math.round(lostValue)}  ` +
      `back on ${d(livePhones.get(phone)!.createdAt)}${tag}`
    );
    entries.forEach(e =>
      console.log(`     ${d(e.registrationDate)} -> ${d(e.deletedAt)}  ${e.deletionReason.padEnd(6)} ` +
        `inv=${e.totalInvoices} cust=${e.customersCount}  "${e.shopName}"`)
    );
  });

  // Deleted more than once, whether or not they came back.
  const repeat = [...byPhone.entries()].filter(([, e]) => e.length > 1);
  console.log(`\n--- deleted more than once (any reason): ${repeat.length} shops ---`);
  repeat.forEach(([phone, e]) => console.log(`${phone}  ${e.length} deletions`));

  // How many catalogues can spring the trap: a saved item with grossWt 0/absent
  // is exactly the one that used to wipe a typed gross weight.
  const total = await db.collection("catalogproducts").countDocuments({});
  const zero = await db.collection("catalogproducts").countDocuments({
    $or: [{ grossWt: 0 }, { grossWt: null }, { grossWt: { $exists: false } }],
  });
  const shopsWithZero = await db.collection("catalogproducts").distinct("dukandarId", {
    $or: [{ grossWt: 0 }, { grossWt: null }, { grossWt: { $exists: false } }],
  });
  const shopsWithAny = await db.collection("catalogproducts").distinct("dukandarId", {});

  console.log(`\n--- catalogue exposure ---`);
  console.log(`saved items total                    : ${total}`);
  console.log(`saved items with no gross weight (0) : ${zero}${total ? `  (${Math.round((zero / total) * 100)}%)` : ""}`);
  console.log(`shops with a catalogue               : ${shopsWithAny.length}`);
  console.log(`shops holding at least one such item : ${shopsWithZero.length}`);
  console.log(`\nEvery one of those shops could lose a typed gross weight the moment`);
  console.log(`they pick that item from "Select Saved Item".`);

  await mongoose.disconnect();
})().catch(async e => { console.error("FAILED:", e); await mongoose.disconnect(); process.exit(1); });
