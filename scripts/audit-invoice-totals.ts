/**
 * READ-ONLY audit: stored totals vs the figure the app displays and prints,
 * for both full-payment invoices and advance orders. Writes nothing.
 *
 *   NODE_ENV=dev  npx tsx scripts/audit-invoice-totals.ts
 *   NODE_ENV=prod npx tsx scripts/audit-invoice-totals.ts
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

const num = (v: any) => Number(v ?? 0);

/** The rule the mobile app uses, and the one Order's pre-save hook already implements. */
const makingFor = (type: string, grossWt: number, rate: number, value: number) => {
  const t = String(type || "").toLowerCase().replace(/\s+/g, "");
  if (["percent", "percentage", "%"].includes(t)) return (grossWt * rate * value) / 100;
  if (t === "pergram") return grossWt * value;
  return value;
};

const isPct = (t: any) =>
  ["percent", "percentage", "%"].includes(String(t || "").toLowerCase());

async function auditInvoices() {
  const docs = await mongoose.connection
    .collection("invoices").find({ deletedAt: null }).toArray();

  let bad = 0, gap = 0;
  const worst: Array<{ n: string; d: number }> = [];

  for (const inv of docs) {
    const items: any[] = inv.items || [];
    if (!items.length) continue;
    let correct = 0;
    for (const it of items) {
      const gross = num(it.grossWeight);
      const net = num(it.netWeight) || gross - num(it.lessWeight);
      const rate = num(it.rate);
      const before =
        net * rate +
        makingFor(it.makingType, gross, rate, num(it.makingCharge)) +
        num(it.chargeAmount);
      correct += before - (isPct(it.discountType) ? (before * num(it.discount)) / 100 : num(it.discount));
    }
    const ex = Array.isArray(inv.ornamentExchanges)
      ? inv.ornamentExchanges.reduce((s: number, e: any) => s + num(e.amount), 0) : 0;
    correct = Math.max(correct - ex, 0);

    const d = correct - num(inv.subTotal);
    if (Math.abs(d) > 1) { bad++; gap += d; worst.push({ n: String(inv.invoiceNumber), d }); }
  }

  console.log(`\nFULL PAYMENT (invoices)`);
  console.log(`  scanned    : ${docs.length}`);
  console.log(`  mismatched : ${bad}`);
  console.log(`  understated: ₹${gap.toFixed(2)}`);
  worst.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  worst.slice(0, 5).forEach(w => console.log(`     ${w.n.padEnd(12)} ₹${w.d.toFixed(2)}`));
}

async function auditOrders() {
  const docs = await mongoose.connection
    .collection("orders").find({ deletedAt: null }).toArray();

  let bad = 0, gap = 0, skipped = 0;
  const worst: Array<{ n: string; d: number }> = [];

  for (const ord of docs) {
    const items: any[] = ord.items || [];
    if (!items.length) continue;
    let correct = 0;
    for (const it of items) {
      const net = num(it.weight);
      const gross = it.grossWeight != null ? num(it.grossWeight) : net;
      // Advance orders price against a tentative rate: the item's own rate if
      // set, else the order's booking rate. Mirrors order.model.ts.
      const rate = num(it.rate) || num(ord.bookingRate);
      const before =
        net * rate +
        makingFor(it.makingChargeType, gross, rate, num(it.makingChargeValue)) +
        num(it.chargeAmount);
      correct += Math.max(0, before - (isPct(it.discountType) ? (before * num(it.discount)) / 100 : num(it.discount)));
    }
    const ex = Array.isArray(ord.ornamentExchanges)
      ? ord.ornamentExchanges.reduce((s: number, e: any) => s + num(e.amount), 0) : 0;
    correct = Math.max(correct - ex, 0);

    // Legacy orders predate subTotal/gstAmount; for those the pre-GST figure
    // is amount - gstAmount. Comparing against a missing field reported the
    // whole order as understated.
    const storedPreGst = ord.subTotal != null ? num(ord.subTotal) : num(ord.amount) - num(ord.gstAmount);
    if (ord.subTotal == null && ord.amount == null) { skipped++; continue; }
    const d = correct - storedPreGst;
    if (Math.abs(d) > 1) { bad++; gap += d; worst.push({ n: String(ord.orderNumber), d }); }
  }

  console.log(`\nADVANCE (orders)`);
  console.log(`  scanned    : ${docs.length}`);
  console.log(`  mismatched : ${bad}`);
  console.log(`  understated: ₹${gap.toFixed(2)}`);
  console.log(`  skipped     : ${skipped} (no stored total at all)`);
  worst.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  worst.slice(0, 5).forEach(w => console.log(`     ${w.n.padEnd(12)} ₹${w.d.toFixed(2)}`));
}

async function run() {
  const uri = getMongoURI();
  if (!uri) throw new Error("MongoDB URI missing for " + NODE_ENV);
  await mongoose.connect(uri);
  console.log(`connected [${NODE_ENV}] — READ ONLY`);
  await auditInvoices();
  await auditOrders();
  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
