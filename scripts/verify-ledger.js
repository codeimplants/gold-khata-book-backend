// Live-API regression check. Needs the server and MongoDB running
// (../start.cmd), and logs in with the store-review test number so it
// never spends SMS quota.
// The retailer account: held cash and melt credit, against the live API.
const BASE = 'http://localhost:7100/api';
const j = async r => { const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 400) }; } };
const req = (m, p, b, tk) => fetch(BASE + p, {
  method: m,
  headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: 'Bearer ' + tk } : {}) },
  ...(b ? { body: JSON.stringify(b) } : {}),
}).then(j);
const post = (p, b, tk) => req('POST', p, b, tk);
const get = (p, tk) => req('GET', p, null, tk);

let fail = 0;
const eq = (l, g, w) => { const ok = String(g) === String(w); if (!ok) fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}: got ${g}, want ${w}`); };
const g3 = n => (Number(n || 0) + 0).toFixed(3).replace(/^-(0\.0+)$/, '$1');
const r2 = n => (Number(n || 0) + 0).toFixed(2).replace(/^-(0\.0+)$/, '$1');

(async () => {
  const s = await post('/login/send-otp', { phone: '1234567890' });
  const v = await post('/login/verify-otp', { phone: '1234567890', otp: '123456', sessionId: s.sessionId, fullhash: s.fullhash });
  const tk = v.token;

  const c = await post('/customer', { name: 'Ledger E2E ' + Date.now(), phone: '9' + Math.floor(Math.random() * 1e9).toString().padStart(9, '0') }, tk);
  const cid = c?.data?._id || c?.data?.id;

  const mkOrder = async (weight) => {
    const o = await post('/orders', {
      customerId: cid, paymentMode: 'advance', includeGST: false, bookingRate: 15000,
      items: [{ itemName: 'Bangles', weight, purity: 99.5, wastage: 0, rate: 15000 }],
    }, tk);
    const ord = o?.data || o;
    return { ord, id: ord._id || ord.id };
  };

  // ---- paying without settling -------------------------------------------
  const { ord, id: oid } = await mkOrder(4.36);
  console.log("the wholesaler's own scenario");
  eq('owes metal', g3(ord.remainingWeight), '4.360');

  let acc = (await post(`/retailer-account/${cid}/cash`, { amount: 150000, notes: 'waiting for a rate' }, tk))?.data;
  console.log('\n1) pays Rs.1,50,000 and keeps the metal position open');
  eq('held cash', r2(acc.heldCash), '150000.00');
  const cur = (await get(`/orders/${oid}`, tk))?.data;
  eq('metal untouched', g3(cur.remainingWeight), '4.360');

  const alloc = (await post(`/retailer-account/${cid}/cash/allocate`,
    { orderId: oid, amount: 65400, goldRate: 15000, notes: 'rate suits' }, tk))?.data;
  console.log('\n2) days later, allocates 4.360 g worth @ Rs.15,000');
  eq('metal cleared', g3(alloc.order.remainingWeight), '0.000');
  eq('still held', r2(alloc.account.heldCash), '84600.00');
  eq('order completed', alloc.order.status === 'completed' ? 1 : 0, 1);

  console.log('\n3) cannot allocate more than is held');
  const over = await post(`/retailer-account/${cid}/cash/allocate`,
    { orderId: oid, amount: 999999, goldRate: 15000 }, tk);
  eq('rejected', over?.success === false ? 1 : 0, 1);

  // ---- melt credit, split across a bill and a payout ----------------------
  const { id: oid2 } = await mkOrder(20);

  console.log('\n4) a melt lot credits 9.068 g of 99.50');
  acc = (await post(`/retailer-account/${cid}/melt`,
    { weight: 9.068, notes: 'lot from 10 g brought in' }, tk))?.data;
  eq('melt credit', g3(acc.meltCredit), '9.068');

  console.log('\n5) applies 6.000 g to a bill, keeps the rest');
  const applied = (await post(`/retailer-account/${cid}/melt/apply`,
    { orderId: oid2, weight: 6 }, tk))?.data;
  eq('credit left', g3(applied.account.meltCredit), '3.068');
  eq('order metal reduced', g3(applied.order.remainingWeight), '14.000');

  console.log('\n6) takes the remaining 3.068 g out as cash');
  acc = (await post(`/retailer-account/${cid}/melt/payout`,
    { weight: 3.068, rate: 15000, notes: 'paid out' }, tk))?.data;
  eq('credit cleared', g3(acc.meltCredit), '0.000');

  console.log('\n7) cannot apply melt credit that is not there');
  const noCredit = await post(`/retailer-account/${cid}/melt/apply`, { orderId: oid2, weight: 5 }, tk);
  eq('rejected', noCredit?.success === false ? 1 : 0, 1);

  // ---- the invariant ------------------------------------------------------
  console.log('\n8) balances are recomputed from entries, never incremented');
  const fresh = (await get(`/retailer-account/${cid}`, tk))?.data;
  const cashSum = fresh.entries.reduce((s, e) => s + Number(e.cashDelta || 0), 0);
  const metalSum = fresh.entries.reduce((s, e) => s + Number(e.metalDelta || 0), 0);
  eq('heldCash = sum of cashDelta', r2(fresh.heldCash), r2(cashSum));
  eq('meltCredit = sum of metalDelta', g3(fresh.meltCredit), g3(metalSum));
  eq('every movement recorded', fresh.entries.length, 5);

  console.log('\n' + (fail === 0 ? 'ALL PASSED' : fail + ' FAILED'));
  process.exitCode = fail === 0 ? 0 : 1;
})().catch(e => { console.error('ERROR', e.message); process.exitCode = 1; });
