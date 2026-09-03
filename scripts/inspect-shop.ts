/**
 * READ-ONLY inspection of one shop, by phone. Writes nothing.
 *
 *   NODE_ENV=prod npx ts-node scripts/inspect-shop.ts 9231531962
 *
 * Written 2026-08-18 for a support report: "gross weight 8.075 was not working
 * when creating a full payment bill; deleting and recreating the account fixed
 * it." Prints the account's deletion history, the invoice-number counter, and
 * every item line ever saved, so the claim can be checked against data instead
 * of guessed at.
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

const phoneArg = process.argv[2];
if (!phoneArg) throw new Error("usage: inspect-shop.ts <phone>");
const phone = Number(phoneArg);

const j = (v: unknown) => JSON.stringify(v, null, 2);

(async () => {
  await mongoose.connect(getMongoURI());
  const db = mongoose.connection.db!;
  console.log(`\n=== ${NODE_ENV} / phone ${phone} ===`);

  const names = (await db.listCollections().toArray()).map(c => c.name).sort();
  console.log("\ncollections:", names.join(", "));

  // 1. current account
  const duk = await db.collection("dukandars").find({ phone }).toArray();
  console.log(`\n--- dukandars (${duk.length}) ---`);
  duk.forEach(d => console.log(j({
    _id: d._id, phone: d.phone, shopDetails: d.shopDetails,
    createdAt: d.createdAt, deviceInfo: d.deviceInfo,
    gst: d.gst, keys: Object.keys(d),
  })));

  // 2. deletion history
  const del = await db.collection("deleteduserlogs").find({ phone }).sort({ deletedAt: 1 }).toArray();
  console.log(`\n--- deleteduserlogs (${del.length}) ---`);
  del.forEach(d => console.log(j(d)));

  const ids = [...duk.map(d => d._id), ...del.map(d => d.originalDukandarId)].filter(Boolean);
  console.log("\nall dukandarIds ever:", ids.map(String).join(", "));

  // 3. invoice-number counters for each id
  const counterIds = ids.flatMap(id => [`invoice_${id}`, `order_${id}`]);
  const counters = await db.collection("counters").find({ id: { $in: counterIds } }).toArray();
  console.log(`\n--- counters (${counters.length}) ---`);
  counters.forEach(c => console.log(j(c)));

  // 4. invoices across every id this phone has ever had
  const inv = await db.collection("invoices")
    .find({ $or: [{ dukandarId: { $in: ids } }, { userId: { $in: ids } }] })
    .sort({ createdAt: 1 })
    .toArray();
  console.log(`\n--- invoices (${inv.length}) ---`);
  inv.forEach(v => {
    console.log(`\n${v.invoiceNumber}  ${v.createdAt?.toISOString?.() ?? v.createdAt}  owner=${v.dukandarId ?? v.userId}  total=${v.totalAmount}  deletedAt=${v.deletedAt ?? "-"}`);
    (v.items ?? []).forEach((it: any, i: number) => {
      console.log(`   [${i}] ${it.itemName ?? it.name ?? "?"} | ${it.itemType ?? ""}/${it.purity ?? ""} | gross=${it.grossWeight} less=${it.lessWeight} net=${it.netWeight} rate=${it.rate} making=${it.makingCharge}(${it.makingType}) amount=${it.amount ?? it.totalAmount ?? "?"}`);
    });
  });

  // 5. anything else keyed to those ids
  for (const coll of ["shopdetails", "catalogproducts", "customers", "orders", "metalrates", "appopenlogs", "purchases", "purchaseoldgolds", "items"]) {
    if (!names.includes(coll)) continue;
    const q = coll === "shopdetails"
      ? { _id: { $in: duk.map(d => d.shopDetails).filter(Boolean) } }
      : { $or: [{ dukandarId: { $in: ids } }, { userId: { $in: ids } }, { shopId: { $in: ids } }] };
    const docs = await db.collection(coll).find(q).toArray();
    console.log(`\n--- ${coll} (${docs.length}) ---`);
    if (coll === "shopdetails" || coll === "metalrates" || coll === "appopenlogs") docs.forEach(d => console.log(j(d)));
    else if (coll === "catalogproducts") docs.forEach(d => console.log(`  ${d.name} | ${d.category}/${d.purity} | grossWeight=${d.grossWeight} lessWeight=${d.lessWeight} making=${d.makingCharges}(${d.makingChargeType})`));
  }

  // 6. did 8.075 ever land anywhere, for any shop?
  const withWeight = await db.collection("invoices")
    .find({ "items.grossWeight": 8.075 }, { projection: { invoiceNumber: 1, dukandarId: 1, userId: 1, createdAt: 1, "items.grossWeight": 1 } })
    .limit(20).toArray();
  console.log(`\n--- any invoice anywhere with a gross weight of exactly 8.075 (${withWeight.length}) ---`);
  withWeight.forEach(v => console.log(j(v)));

  await mongoose.disconnect();
})().catch(async e => { console.error("FAILED:", e); await mongoose.disconnect(); process.exit(1); });
