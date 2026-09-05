// Wipes this environment's data and seeds a realistic wholesale book.
//
// Destructive by design — it drops every retailer, order and account on the
// configured database before writing. Guarded to NODE_ENV=dev so it can never
// be pointed at a live book by accident.
//
// Needs the server and MongoDB running (../start.cmd):
//   npm run seed:demo

require('dotenv').config();

const BASE = process.env.SEED_API || 'http://localhost:7100/api';

const j = async r => { const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 300) }; } };
const req = (m, p, b, tk) => fetch(BASE + p, {
  method: m,
  headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: 'Bearer ' + tk } : {}) },
  ...(b ? { body: JSON.stringify(b) } : {}),
}).then(j);
const post = (p, b, tk) => req('POST', p, b, tk);

/** Today's 24K 99.50 rate the demo prices against. */
const RATE = 15450;

// Real-sounding wholesale customers, and orders shaped like real ones: a few
// ornaments at 22K with a Tunch in the 3-8% band, settled to varying degrees so
// the dues list has something to say.
const RETAILERS = [
  {
    name: 'Sundha Jewellers', phone: '9822014455', code: 'Pune',
    orders: [
      { item: 'Gents Kada',    weight: 42.310, purity: 91.6, wastage: 6 },
      { item: 'Ladies Bangles', weight: 68.740, purity: 91.6, wastage: 5 },
    ],
    payGold: 30,          // hands back 30 g of settlement metal
    heldCash: 150000,     // and parks cash, waiting for a rate
  },
  {
    name: 'Kalyan Retail', phone: '9890116677', code: 'Nashik',
    orders: [{ item: 'Chain 20"', weight: 35.500, purity: 91.6, wastage: 4 }],
    payGold: 0,
  },
  {
    name: 'Mehta Ornaments', phone: '9765432211', code: 'Nagpur',
    orders: [{ item: 'Necklace set', weight: 88.120, purity: 75, wastage: 8 }],
    payGold: 96,          // metal cleared, GST left standing
    gst: true,
  },
  {
    name: 'Raj Gold House', phone: '9822778899', code: 'Solapur',
    orders: [
      { item: 'Mangalsutra', weight: 18.650, purity: 91.6, wastage: 5 },
      { item: 'Ear tops',    weight:  6.220, purity: 75,   wastage: 7 },
    ],
    payGold: 0,
    meltCredit: 9.068,    // brought old ornaments in, not yet applied
  },
  {
    name: 'Shree Balaji Jewellers', phone: '9011223344', code: 'Kolhapur',
    orders: [{ item: 'Bracelet', weight: 24.400, purity: 91.6, wastage: 3 }],
    settled: true,        // paid off entirely
  },
];

(async () => {
  if ((process.env.NODE_ENV || 'dev') !== 'dev') {
    console.error(`Refusing to seed: NODE_ENV is "${process.env.NODE_ENV}", not "dev".`);
    process.exitCode = 1;
    return;
  }

  // ---- wipe -------------------------------------------------------------
  const mongoose = require('mongoose');
  const uri = process.env.DEV_DB_URL;
  if (!uri) throw new Error('DEV_DB_URL is not set');

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  // shopdetails stays: without it the app bounces every login into
  // Complete Registration, and re-registering by hand each seed is friction
  // for no benefit.
  const keep = new Set(['dukandars', 'admins', 'platformconfigs', 'tutorials', 'shopdetails']);
  const dropped = [];
  for (const c of await db.listCollections().toArray()) {
    if (keep.has(c.name)) continue;
    await db.collection(c.name).deleteMany({});
    dropped.push(c.name);
  }
  await mongoose.disconnect();
  console.log(`wiped: ${dropped.join(', ') || '(nothing)'}`);
  console.log('kept:  the shop account itself, so the login still works\n');

  // ---- seed -------------------------------------------------------------
  const s = await post('/login/send-otp', { phone: '1234567890' });
  const v = await post('/login/verify-otp', {
    phone: '1234567890', otp: '123456', sessionId: s.sessionId, fullhash: s.fullhash,
  });
  const tk = v.token;
  if (!tk) throw new Error('login failed: ' + JSON.stringify(v).slice(0, 200));

  // A shop with no details is sent to Complete Registration instead of the
  // dashboard, so make sure one exists before seeding a book into it.
  const existing = await req('GET', '/shopDetails', null, tk);
  const hasShop = !!(existing?.data && (existing.data.shopName || existing.data?.[0]?.shopName));
  if (!hasShop) {
    const made = await post('/shopDetails', {
      shopName: 'Sundha Gold Wholesalers',
      ownerName: 'Ramesh Shah',
      address: { line1: 'Laxmi Road', city: 'Pune', state: 'Maharashtra', pincode: '411002' },
    }, tk);
    console.log(made?.success ? '  shop details created' : `  ! shop details: ${JSON.stringify(made).slice(0, 140)}`);
  }

  for (const r of RETAILERS) {
    const c = await post('/customer', { name: r.name, phone: r.phone, address: r.code }, tk);
    const cid = c?.data?._id || c?.data?.id;
    if (!cid) { console.log(`  ! ${r.name}: ${JSON.stringify(c).slice(0, 120)}`); continue; }

    let metal = 0;
    for (const o of r.orders) {
      const res = await post('/orders', {
        customerId: cid,
        paymentMode: 'advance',
        includeGST: !!r.gst,
        ...(r.gst ? { gstRate: 3 } : {}),
        bookingRate: RATE,
        items: [{ itemName: o.item, weight: o.weight, purity: o.purity, wastage: o.wastage, rate: RATE }],
      }, tk);
      const ord = res?.data || res;
      const oid = ord._id || ord.id;
      metal += Number(ord.remainingWeight || 0);

      if (r.settled) {
        await post(`/orders/${oid}/payments`, {
          amount: 0, goldRate: 0, goldWeight: ord.remainingWeight, goldPurity: 99.5,
          notes: 'settled in metal',
        }, tk);
      } else if (r.payGold > 0) {
        const give = Math.min(r.payGold, Number(ord.remainingWeight || 0));
        if (give > 0) {
          await post(`/orders/${oid}/payments`, {
            amount: 0, goldRate: 0, goldWeight: give, goldPurity: 99.5, notes: 'part settlement',
          }, tk);
          r.payGold -= give;
        }
      }
    }

    if (r.heldCash) {
      await post(`/retailer-account/${cid}/cash`, {
        amount: r.heldCash, notes: 'holding for a better rate',
      }, tk);
    }
    if (r.meltCredit) {
      await post(`/retailer-account/${cid}/melt`, {
        weight: r.meltCredit, notes: 'lot melted, credit not yet applied',
      }, tk);
    }

    console.log(`  ${r.name.padEnd(24)} ${r.orders.length} order(s), ${metal.toFixed(3)} gm raised`);
  }

  console.log('\nseeded. log in with 1234567890 / 123456');
})().catch(e => { console.error('FAILED', e.message); process.exitCode = 1; });
