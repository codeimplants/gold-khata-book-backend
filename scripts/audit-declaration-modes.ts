/**
 * READ-ONLY: how much old-gold declaration data exists, split by mode.
 *
 *   NODE_ENV=dev     npx ts-node scripts/audit-declaration-modes.ts
 *   NODE_ENV=preprod npx ts-node scripts/audit-declaration-modes.ts
 *   NODE_ENV=prod    npx ts-node scripts/audit-declaration-modes.ts
 *
 * Written 2026-08-24, before two changes that both hinge on how many records
 * are already out there:
 *
 *   1. "Sold to us" counts are to exclude mode:"exchange" — exchanges belong to
 *      their bill, not to a standalone purchase count.
 *   2. Exchange declarations are to stop drawing POG-n from the shared
 *      per-shop sequence and carry their order's number instead.
 *
 * If no shop has exchange declarations yet, both can be changed outright with
 * no migration and no renumbering. This answers exactly that, and also checks
 * the two collision cases a derived number would have to survive.
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

const d = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "-"));

(async () => {
  await mongoose.connect(getMongoURI());
  const db = mongoose.connection.db!;

  const all = await db.collection("purchaseOldGold")
    .find({}, {
      projection: {
        userId: 1, customerId: 1, mode: 1, orderId: 1,
        declarationNumber: 1, declarationDate: 1, createdAt: 1,
        deletedAt: 1, totalGrams: 1, totalAmount: 1,
        photos: 1, items: 1, witnesses: 1, idProofs: 1,
      },
    })
    .sort({ createdAt: 1 })
    .toArray();

  const live = all.filter(r => !r.deletedAt);
  const standalone = live.filter(r => r.mode !== "exchange");
  const exchange = live.filter(r => r.mode === "exchange");

  console.log(`\n=== ${NODE_ENV} — old-gold declarations ===`);
  console.log(`total records (incl. soft-deleted) : ${all.length}`);
  console.log(`live records                       : ${live.length}`);
  console.log(`  mode "standalone" (true POG)     : ${standalone.length}`);
  console.log(`  mode "exchange"   (on a bill)    : ${exchange.length}`);
  console.log(`  soft-deleted                     : ${all.length - live.length}`);

  const shops = (list: any[]) => new Set(list.map(r => String(r.userId)));
  console.log(`\nshops with any declaration         : ${shops(live).size}`);
  console.log(`shops with a standalone one        : ${shops(standalone).size}`);
  console.log(`shops with an exchange one         : ${shops(exchange).size}`);

  // ── The migration question: do exchange records carry POG numbers today? ──
  const exchangeWithPog = exchange.filter(r => /^POG-/.test(String(r.declarationNumber || "")));
  console.log(`\n--- would need renumbering (exchange holding a POG-n) : ${exchangeWithPog.length} ---`);

  if (exchange.length) {
    console.log(`\n--- every live exchange declaration ---`);
    for (const r of exchange) {
      const shop = await db.collection("dukandars")
        .findOne({ _id: r.userId }, { projection: { phone: 1, name: 1 } });
      const inv = await db.collection("invoices")
        .findOne({ _id: r.orderId }, { projection: { invoiceNumber: 1 } });
      const ord = await db.collection("orders")
        .findOne({ _id: r.orderId }, { projection: { orderNumber: 1 } });
      const target = inv?.invoiceNumber
        ? `invoice ${inv.invoiceNumber}`
        : ord?.orderNumber
          ? `order ${ord.orderNumber}`
          : r.orderId ? `MISSING (orderId ${r.orderId})` : "NO orderId";
      const photoCount =
        (r.photos?.length || 0) +
        (r.items || []).reduce((n: number, i: any) => n + (i.photos?.length || 0), 0) +
        (r.witnesses || []).reduce((n: number, w: any) => n + (w.photos?.length || 0), 0) +
        (r.idProofs || []).reduce((n: number, e: any) => n + (e.photos?.length || 0), 0);
      console.log(
        `  ${String(r.declarationNumber).padEnd(10)} ${d(r.createdAt)}  ` +
        `shop ${shop?.phone ?? "?"}  →  ${target}  ` +
        `(${r.totalGrams ?? 0}g, ${photoCount} photo${photoCount === 1 ? "" : "s"})`
      );
    }
  }

  // ── Collision case 1: more than one declaration against the same order ──
  const byOrder = new Map<string, any[]>();
  live.filter(r => r.orderId).forEach(r => {
    const k = String(r.orderId);
    if (!byOrder.has(k)) byOrder.set(k, []);
    byOrder.get(k)!.push(r);
  });
  const dupOrders = [...byOrder.entries()].filter(([, rows]) => rows.length > 1);
  console.log(`\n--- orders carrying more than one declaration : ${dupOrders.length} ---`);
  dupOrders.forEach(([orderId, rows]) =>
    console.log(`  order ${orderId}: ${rows.map(r => r.declarationNumber).join(", ")}`)
  );

  // ── Collision case 2: ADV twin — an advance order and its completion
  //    invoice share a number, so a derived declaration number would too.
  const advTwins = await db.collection("invoices").aggregate([
    { $match: { invoiceNumber: { $regex: "^ADV-" }, deletedAt: null } },
    { $count: "n" },
  ]).toArray();
  console.log(`\ncompletion invoices reusing an ADV- number : ${advTwins[0]?.n ?? 0}`);
  console.log(`  (only a risk if one of those ever carries an exchange)`);

  // ── Is the POG sequence already burnt past the standalone records? ──
  const counters = await db.collection("counters")
    .find({ id: { $regex: "^purchaseOldGold_" } } as any)
    .toArray();
  if (counters.length) {
    console.log(`\n--- POG sequence per shop ---`);
    for (const c of counters) {
      const uid = String(c.id).replace("purchaseOldGold_", "");
      const mine = live.filter(r => String(r.userId) === uid);
      const std = mine.filter(r => r.mode !== "exchange").length;
      const exc = mine.filter(r => r.mode === "exchange").length;
      const shop = await db.collection("dukandars")
        .findOne({ _id: new mongoose.Types.ObjectId(uid) }, { projection: { phone: 1 } })
        .catch(() => null);
      console.log(
        `  shop ${shop?.phone ?? uid}: counter at ${c.seq ?? "?"}, ` +
        `${std} standalone + ${exc} exchange live` +
        (exc > 0 ? `  ← ${exc} gap(s) in the POG series` : "")
      );
    }
  } else {
    console.log(`\nno purchaseOldGold_* counters exist yet`);
  }

  console.log("");
  await mongoose.disconnect();
})().catch(async e => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
