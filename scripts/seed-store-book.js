// Seeds a fuller wholesale book for store screenshots and App Review demos:
// twelve retailers, sales and receipts spread over the last two weeks, and
// entries dated today, so the Khata home, the Day Book and the statements all
// have something real to show.
//
// It also carries the retailer-account cases a wholesaler meets every week:
//   - cash paid against a gold due with the rate to be fixed later
//     (Raj Gold House: still held; Kalyan Retail: held, then fixed)
//   - an advance in gold, partly used on a later sale (Shubh Laxmi Jewellers)
//   - an advance in cash with no sale yet (Siddhivinayak Gold)
//
// Everything goes through the API, so every weight and balance comes from
// the server's own pricing (goldPricing.ts), exactly as from the app.
//
// Two modes.
//
// Local (default). Destructive, like seed-demo-data.js: it wipes the configured
// database's records first and keeps only the shop account. Guarded to
// NODE_ENV=dev, and it refuses any database whose name does not end in _demo.
// The frontend's APP_STORE_4.3_REWORK.md, section 7, has the setup. Point it
// at the demo database, never the owner's dev data:
//
//   DEV_DB_URL=mongodb://localhost:27017/gold_khata_book_demo NODE_ENV=dev npm run seed:store
//
// --api-only. For the App Review demo account on a deployed server. It never
// touches a database directly and never deletes anything: it signs in as the
// demo account (1234567890) and adds, through the API, only the retailers that
// account does not already have, by name. It creates shop details only if
// there are none. SEED_API must be set explicitly. Run --dry-run first: it
// signs in, lists what is there and what would be added, and writes nothing.
//
//   SEED_API=https://api.goldkhatabook.codeimplants.com/api node scripts/seed-store-book.js --api-only --dry-run
//   SEED_API=https://api.goldkhatabook.codeimplants.com/api node scripts/seed-store-book.js --api-only

require('dotenv').config();

const API_ONLY = process.argv.includes('--api-only');
const DRY_RUN = process.argv.includes('--dry-run');
const BASE = process.env.SEED_API || 'http://localhost:7100/api';

const j = async r => { const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 300) }; } };
const req = (m, p, b, tk) => fetch(BASE + p, {
  method: m,
  headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: 'Bearer ' + tk } : {}) },
  ...(b ? { body: JSON.stringify(b) } : {}),
}).then(j);
const post = (p, b, tk) => req('POST', p, b, tk);

/** A date `daysAgo` days back, at a shop-hours time, so entries sort sensibly. */
const at = (daysAgo, hour = 11, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

// The 99.50 rate drifts a little over the fortnight, as it does.
const rateOn = daysAgo => 14770 - daysAgo * 18;

// Phone numbers are the 98765432xx dummy pattern, never plausible real
// numbers: they appear in store screenshots and, on the production demo
// account, behind a WhatsApp Remind button an App Reviewer might tap.
// sales: [daysAgo, hour, items[[name, grossWeight, purity, wastage]]]
// receipts: [daysAgo, hour, { gold?: [weight, purity], cash?: amount, settles? }]
// account: [daysAgo, hour, { cash?: amount, gold?: [weight, purity], note }]
//   money or metal kept on the retailer's account, NOT against a sale: cash
//   with the rate fixed later, or an advance (POST /retailer-account/:id/cash
//   or /gold).
// fixRate: [daysAgo, hour, amount] held cash put on the oldest sale owing
//   gold, at that day's rate (cash/allocate).
// useGold: [daysAgo, hour] gold held put on the oldest sale owing gold, up
//   to what it owes (melt/apply).
// gst: true bills 3% GST on that retailer's sales. GST is owed as cash, so
// these are the retailers with a cash balance as well as a gold one.
const RETAILERS = [
  {
    name: 'Shree Ganesh Jewellers', phone: '9876543201', city: 'Satara', gst: true,
    sales: [
      [12, 11, [['Ladies Bangles', 64.380, 91.6, 5], ['Gents Kada', 38.210, 91.6, 6]]],
      [4, 16, [['Mangalsutra', 22.640, 91.6, 5]]],
      [0, 11, [['Necklace Set', 48.920, 91.6, 7]]],
    ],
    receipts: [
      [9, 15, { gold: [45.000, 99.5] }],
      [2, 12, { cash: 250000 }],
    ],
  },
  {
    name: 'Laxmi Alankar', phone: '9876543202', city: 'Sangli',
    sales: [
      [11, 12, [['Chain 20 inch', 31.750, 91.6, 4], ['Ring Set', 12.430, 91.6, 6]]],
      [3, 13, [['Ear Tops', 9.860, 75, 7]]],
    ],
    receipts: [
      [6, 11, { gold: [30.000, 99.5] }],
      [0, 13, { gold: [8.500, 91.6] }],
    ],
  },
  {
    name: 'Mehta Ornaments', phone: '9876543203', city: 'Nagpur', gst: true,
    sales: [
      [10, 15, [['Necklace Set', 88.120, 75, 8]]],
    ],
    receipts: [
      [5, 12, { gold: [60.000, 99.5] }],
    ],
  },
  {
    name: 'Raj Gold House', phone: '9876543204', city: 'Solapur',
    sales: [
      [8, 11, [['Mangalsutra', 18.650, 91.6, 5], ['Ear Tops', 6.220, 75, 7]]],
      [1, 17, [['Pendant Set', 14.380, 91.6, 6]]],
    ],
    receipts: [],
    // Owes gold, paid cash, and wants to fix the rate himself later. The gold
    // due stands until he does.
    account: [[1, 18, { cash: 300000, note: 'Rate to be fixed later' }]],
  },
  {
    name: 'Navkar Jewels', phone: '9876543205', city: 'Kolhapur',
    sales: [
      [13, 12, [['Ladies Bangles', 72.540, 91.6, 4]]],
    ],
    receipts: [
      [7, 16, { gold: [40.000, 99.5] }],
      [1, 11, { gold: [30.000, 99.5], cash: 40000 }],
    ],
  },
  {
    name: 'Om Sai Jewellers', phone: '9876543206', city: 'Baramati', gst: true,
    sales: [
      [6, 14, [['Haar', 56.300, 91.6, 6]]],
      [0, 15, [['Bracelet', 24.400, 91.6, 3]]],
    ],
    receipts: [
      [2, 15, { cash: 300000 }],
    ],
  },
  {
    name: 'Kalyan Retail', phone: '9876543207', city: 'Nashik',
    sales: [
      [9, 13, [['Chain 20 inch', 35.500, 91.6, 4]]],
    ],
    receipts: [],
    // The same case a week on: cash held on day 7, the rate fixed on day 3.
    account: [[7, 15, { cash: 200000, note: 'Rate to be fixed later' }]],
    fixRate: [[3, 12, 200000]],
  },
  {
    name: 'Annapurna Alankar', phone: '9876543208', city: 'Ahmednagar', gst: true,
    sales: [
      [5, 11, [['Ring Set', 18.910, 91.6, 6], ['Ear Tops', 7.480, 91.6, 7]]],
    ],
    receipts: [
      [0, 12, { gold: [12.000, 99.5] }],
    ],
  },
  {
    name: 'Shree Balaji Jewellers', phone: '9876543209', city: 'Latur',
    sales: [
      [12, 16, [['Bracelet', 24.400, 91.6, 3]]],
    ],
    // Settled in full: a clear account belongs in the book too.
    settleInFull: [4, 12],
    receipts: [],
  },
  {
    name: 'Sundha Jewellers', phone: '9876543210', city: 'Pune',
    sales: [
      [7, 12, [['Gents Kada', 42.310, 91.6, 6]]],
      [2, 11, [['Ladies Bangles', 68.740, 91.6, 5]]],
    ],
    receipts: [
      [3, 14, { gold: [25.000, 99.5] }],
    ],
  },
  {
    // A gold advance: a 50 g bar left ahead of Diwali orders, part of it used
    // on the first of them. The rest stays held for the next.
    name: 'Shubh Laxmi Jewellers', phone: '9876543211', city: 'Karad',
    sales: [
      [2, 12, [['Chain 18 inch', 28.400, 91.6, 4]]],
    ],
    receipts: [],
    account: [[6, 11, { gold: [50.000, 99.9], note: 'Bar, advance for Diwali orders' }]],
    useGold: [[2, 13]],
  },
  {
    // A cash advance with no sale yet: the rate is fixed on the sale.
    name: 'Siddhivinayak Gold', phone: '9876543212', city: 'Wai',
    sales: [],
    receipts: [],
    account: [[1, 12, { cash: 250000, note: 'Advance for wedding season orders' }]],
  },
];

(async () => {
  if (API_ONLY) {
    if (!process.env.SEED_API) {
      console.error('Refusing: --api-only needs SEED_API set explicitly, so a deployed server is never the default.');
      process.exitCode = 1;
      return;
    }
    console.log(`api-only${DRY_RUN ? ' (dry run, nothing will be written)' : ''}: ${BASE}`);
  } else if ((process.env.NODE_ENV || 'dev') !== 'dev') {
    console.error(`Refusing to seed: NODE_ENV is "${process.env.NODE_ENV}", not "dev".`);
    process.exitCode = 1;
    return;
  }

  if (!API_ONLY) await wipeLocal();

  // ---- log in as the demo account ---------------------------------------
  const s = await post('/login/send-otp', { phone: '1234567890' });
  const v = await post('/login/verify-otp', { phone: '1234567890', otp: '123456', sessionId: s.sessionId, fullhash: s.fullhash });
  const tk = v.token;
  if (!tk) throw new Error('login failed: ' + JSON.stringify(v).slice(0, 200));

  const existing = await req('GET', '/shopDetails', null, tk);
  const hasShop = !!(existing?.data && (existing.data.shopName || existing.data?.[0]?.shopName));
  const already = await req('GET', '/customer', null, tk);
  const existingNames = new Set((already?.data || []).map(c => String(c.name || '').trim().toLowerCase()));
  const orders = await req('GET', '/orders', null, tk);
  const orderCount = Array.isArray(orders?.data) ? orders.data.length : Array.isArray(orders?.data?.orders) ? orders.data.orders.length : '?';
  console.log(`demo account: shop details ${hasShop ? 'present' : 'missing'}, ${existingNames.size} retailer(s), ${orderCount} sale(s)`);
  const toAdd = RETAILERS.filter(r => !existingNames.has(r.name.toLowerCase()));
  console.log(`would add ${toAdd.length} of ${RETAILERS.length} retailers${toAdd.length < RETAILERS.length ? ' (the rest already exist)' : ''}`);
  if (DRY_RUN) return;

  await seedBook(tk, hasShop, existingNames);
  console.log('\nseeded. log in with 1234567890 / 123456');
})().catch(e => { console.error('FAILED', e.message); process.exitCode = 1; });

async function wipeLocal() {
  // ---- wipe (same rules as seed-demo-data.js) ---------------------------
  const mongoose = require('mongoose');
  const uri = process.env.DEV_DB_URL;
  if (!uri) throw new Error('DEV_DB_URL is not set');
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  console.log(`database: ${db.databaseName}`);
  // The demo book only. dotenv fills DEV_DB_URL from .env when the shell did
  // not set it, and .env points at the owner's own gold_khata_book_dev, so
  // forgetting the variable would otherwise wipe their test data. start.cmd's
  // demo option prints this command, which makes that mistake one step away.
  if (!/_demo$/.test(db.databaseName)) {
    await mongoose.disconnect();
    throw new Error(`refusing to wipe "${db.databaseName}". Local mode only wipes a database whose name ends in _demo. Set DEV_DB_URL=mongodb://localhost:27017/gold_khata_book_demo`);
  }
  const keep = new Set(['dukandars', 'admins', 'platformconfigs', 'tutorials', 'shopdetails']);
  for (const c of await db.listCollections().toArray()) {
    if (!keep.has(c.name)) await db.collection(c.name).deleteMany({});
  }
  await mongoose.disconnect();
}

async function seedBook(tk, hasShop, existingNames) {
  if (!hasShop) {
    await post('/shopDetails', {
      shopName: 'Sundha Gold Wholesalers',
      ownerName: 'Ramesh Shah',
      address: { line1: 'Laxmi Road', city: 'Pune', state: 'Maharashtra', pincode: '411002' },
    }, tk);
  }

  for (const r of RETAILERS) {
    if (existingNames.has(r.name.toLowerCase())) { console.log(`  = ${r.name} already there, skipped`); continue; }
    const c = await post('/customer', { name: r.name, phone: r.phone, address: r.city }, tk);
    const cid = c?.data?._id || c?.data?.id;
    if (!cid) { console.log(`  ! ${r.name}: ${JSON.stringify(c).slice(0, 140)}`); continue; }

    const orders = [];
    for (const [daysAgo, hour, items] of r.sales) {
      const rate = rateOn(daysAgo);
      const res = await post('/orders', {
        customerId: cid,
        paymentMode: 'advance',
        includeGST: !!r.gst,
        ...(r.gst ? { gstRate: 3 } : {}),
        bookingRate: rate,
        orderDate: at(daysAgo, hour),
        items: items.map(([itemName, weight, purity, wastage]) => ({ itemName, weight, purity, wastage, rate })),
      }, tk);
      const ord = res?.data || res;
      const oid = ord?._id || ord?.id;
      if (!oid) { console.log(`  ! sale for ${r.name}: ${JSON.stringify(res).slice(0, 160)}`); continue; }
      orders.push({ id: oid, remaining: Number(ord.remainingWeight || 0), daysAgo });
    }

    // Receipts go against the oldest sale with metal still on it, as a
    // wholesaler applies them. Each is capped at what that sale still owes.
    let receipts = 0;
    for (const [daysAgo, hour, what] of r.receipts) {
      const target = orders.find(o => o.remaining > 0.0005 && o.daysAgo >= daysAgo);
      if (!target) continue;
      const body = { date: at(daysAgo, hour), notes: 'receipt' };
      if (what.gold) {
        const [weight, purity] = what.gold;
        body.goldWeight = Math.min(weight, purity >= 99.5 ? target.remaining : weight);
        body.goldPurity = purity;
      }
      if (what.cash) {
        body.amount = what.cash;
        body.goldRate = rateOn(daysAgo);
        body.settles = what.settles || 'metal';
      }
      const res = await post(`/orders/${target.id}/payments`, body, tk);
      const ord = res?.data || res;
      if (ord && (ord.remainingWeight !== undefined)) target.remaining = Number(ord.remainingWeight || 0);
      else console.log(`  ! receipt for ${r.name}: ${JSON.stringify(res).slice(0, 160)}`);
      receipts++;
    }

    // Money and metal on the account, not against a sale. A server without
    // gold advances yet (an older deploy) answers 404; the rest still seeds.
    let held = 0;
    for (const [daysAgo, hour, what] of r.account || []) {
      const route = what.gold ? 'gold' : 'cash';
      const body = what.gold
        ? { weight: what.gold[0], purity: what.gold[1], date: at(daysAgo, hour), notes: what.note }
        : { amount: what.cash, date: at(daysAgo, hour), notes: what.note };
      const res = await post(`/retailer-account/${cid}/${route}`, body, tk);
      if (res?.success) held++;
      else console.log(`  ! ${route} on account for ${r.name}: ${JSON.stringify(res).slice(0, 120)}${what.gold ? ' (does this server have gold advances yet?)' : ''}`);
    }

    // Held cash onto the oldest sale owing gold, at that day's rate.
    for (const [daysAgo, hour, amount] of r.fixRate || []) {
      const target = orders.find(o => o.remaining > 0.0005);
      if (!target) continue;
      const res = await post(`/retailer-account/${cid}/cash/allocate`, {
        orderId: target.id, amount, goldRate: rateOn(daysAgo), date: at(daysAgo, hour),
        notes: 'Rate fixed by retailer',
      }, tk);
      const ord = res?.data?.order;
      if (ord) target.remaining = Number(ord.remainingWeight || 0);
      else console.log(`  ! fix rate for ${r.name}: ${JSON.stringify(res).slice(0, 120)}`);
    }

    // Gold held onto the oldest sale owing gold, no more than it owes.
    for (const [daysAgo, hour] of r.useGold || []) {
      const acct = await req('GET', `/retailer-account/${cid}`, null, tk);
      const goldHeld = Number(acct?.data?.meltCredit || 0);
      const target = orders.find(o => o.remaining > 0.0005);
      if (!target || goldHeld <= 0.0005) continue;
      const weight = Math.min(goldHeld, target.remaining);
      const res = await post(`/retailer-account/${cid}/melt/apply`, {
        orderId: target.id, weight, date: at(daysAgo, hour),
      }, tk);
      const ord = res?.data?.order;
      if (ord) target.remaining = Number(ord.remainingWeight || 0);
      else console.log(`  ! gold held for ${r.name}: ${JSON.stringify(res).slice(0, 120)}`);
    }

    if (r.settleInFull) {
      const [daysAgo, hour] = r.settleInFull;
      for (const o of orders) {
        if (o.remaining <= 0.0005) continue;
        await post(`/orders/${o.id}/payments`, {
          amount: 0, goldRate: 0, goldWeight: o.remaining, goldPurity: 99.5,
          date: at(daysAgo, hour), notes: 'settled in metal',
        }, tk);
        receipts++;
      }
    }

    console.log(`  ${r.name.padEnd(24)} ${orders.length} sale(s), ${receipts} receipt(s)${held ? `, ${held} held on account` : ''}`);
  }

}
