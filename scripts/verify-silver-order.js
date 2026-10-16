// Live-API regression check for SILVER. Needs the server and MongoDB running
// (../start.cmd), and logs in with the store-review test number so it never
// spends SMS quota.
//
// Silver is a third account beside gold grams and cash: net weight sold, priced
// at net x rate, settled by cash at a silver rate or by silver handed over gram
// for gram. These checks pin that, and pin that a silver line never moves the
// gold figures.
const BASE = 'http://localhost:7100/api';
const j = async r => { const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 400) }; } };
const req = (m, p, b, tk) => fetch(BASE + p, {
  method: m,
  headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: 'Bearer ' + tk } : {}) },
  body: b === undefined ? undefined : JSON.stringify(b),
}).then(j);
const post = (p, b, tk) => req('POST', p, b, tk);

let fail = 0;
const eq = (l, g, w) => { const ok = String(g) === String(w); if (!ok) fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}: got ${g}, want ${w}`); };
const f3 = n => Number(n || 0).toFixed(3);
const f2 = n => Number(n || 0).toFixed(2);
const data = r => r?.data || r;

(async () => {
  const s = await post('/login/send-otp', { phone: '1234567890' });
  const v = await post('/login/verify-otp', { phone: '1234567890', otp: '123456', sessionId: s.sessionId, fullhash: s.fullhash });
  const token = v.token;

  const c = await post('/customer', { name: 'Silver E2E ' + Date.now(), phone: '9' + Math.floor(Math.random() * 1e9).toString().padStart(9, '0') }, token);
  const cid = c?.data?._id || c?.data?.id;

  // 1. Silver only: 2 payal, gross 105.250, packet 5.250, net 100.000 at Rs.95/g.
  let o = data(await post('/orders', {
    customerId: cid, paymentMode: 'advance', includeGST: false, bookingRate: 0,
    items: [{ metal: 'silver', itemName: 'Payal', quantity: 2, grossWeight: 105.25, packetWeight: 5.25, weight: 100, rate: 95 }],
  }, token));
  if (!o?._id && !o?.id) throw new Error('silver create failed: ' + JSON.stringify(o).slice(0, 400));
  const sid = o._id || o.id;

  console.log('silver-only sale: 100.000 g net @ Rs.95');
  eq('line value', f2(o.items[0].silverValue), '9500.00');
  eq('quantity kept', o.items[0].quantity, 2);
  eq('gross kept', f3(o.items[0].grossWeight), '105.250');
  eq('packet kept', f3(o.items[0].packetWeight), '5.250');
  eq('gold owed (none sold)', f3(o.totalWeight), '0.000');
  eq('silver owed', f3(o.remainingSilverWeight), '100.000');
  eq('cash account untouched', f2(o.outstandingCash), '0.00');
  eq('order amount', f2(o.amount), '9500.00');
  eq('estimated balance', f2(o.estimatedBalance), '9500.00');

  console.log('cash towards silver: Rs.4,750 @ Rs.95');
  o = data(await post(`/orders/${sid}/payments`, { amount: 4750, goldRate: 95, settles: 'silver' }, token));
  eq('silver owed', f3(o.remainingSilverWeight), '50.000');
  eq('gold owed still none', f3(o.remainingWeight), '0.000');
  eq('gold weightPaid untouched', f3(o.weightPaid), '0.000');
  eq('still pending', o.status, 'pending');

  console.log('silver handed over: 50.000 g');
  o = data(await post(`/orders/${sid}/payments`, { amount: 0, goldRate: 0, silverWeight: 50, settles: 'silver' }, token));
  eq('silver owed', f3(o.remainingSilverWeight), '0.000');
  eq('completed', o.status, 'completed');

  // 2. Gold and silver on one sale: the worked gold example plus 100 g silver.
  o = data(await post('/orders', {
    customerId: cid, paymentMode: 'advance', includeGST: false, bookingRate: 15450,
    items: [
      { itemName: 'Chain', weight: 10.365, purity: 91.6, wastage: 4, rate: 15450 },
      { metal: 'silver', itemName: 'Glass', weight: 100, rate: 95 },
    ],
  }, token));
  const mid = o._id || o.id;
  console.log('mixed sale: chain (10.000 g fine) + 100.000 g silver');
  eq('gold fine owed', f3(o.totalWeight), '10.000');
  eq('silver owed', f3(o.totalSilverWeight), '100.000');
  eq('amount = 1,54,500 + 9,500', f2(o.amount), '164000.00');
  eq('gold line still priced as gold', f3(o.items[0].fine995), '10.000');

  console.log('gold paid in full, silver still owed');
  o = data(await post(`/orders/${mid}/payments`, { amount: 0, goldRate: 0, goldWeight: 10, goldPurity: 99.5, settles: 'metal' }, token));
  eq('gold owed', f3(o.remainingWeight), '0.000');
  eq('silver owed', f3(o.remainingSilverWeight), '100.000');
  eq('pending while silver is owed', o.status, 'pending');

  o = data(await post(`/orders/${mid}/payments`, { amount: 9500, goldRate: 95, settles: 'silver' }, token));
  eq('silver owed', f3(o.remainingSilverWeight), '0.000');
  eq('completed once both are clear', o.status, 'completed');

  // 3. Validation: purity is still required on gold, not on silver.
  const bad = await post('/orders', {
    customerId: cid, paymentMode: 'advance', includeGST: false,
    items: [{ itemName: 'Ring', weight: 5, rate: 15450 }],
  }, token);
  eq('gold line without purity is refused', bad?.success === false || !!bad?.error || !!bad?.errors, true);

  // 4. Shop rate: silver set on its own leaves gold alone.
  const day = '2099-01-01';
  await req('PUT', '/shop-rate', { date: day, goldRate: 15000 }, token);
  const r = data(await req('PUT', '/shop-rate', { date: day, silverRate: 96 }, token));
  eq('silver rate saved', r.silverRate, 96);
  eq('gold rate kept', r.goldRate, 15000);
  await req('DELETE', `/shop-rate?date=${day}`, undefined, token);

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
