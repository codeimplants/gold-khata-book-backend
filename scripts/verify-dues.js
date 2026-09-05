// Live-API regression check. Needs the server and MongoDB running
// (../start.cmd), and logs in with the store-review test number so it
// never spends SMS quota.
// End-to-end check of the two-account outstanding model against the live API.
const BASE = 'http://localhost:7100/api';

const j = async (res) => {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { _raw: text.slice(0, 300) }; }
};

const post = (path, body, token) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify(body),
  }).then(j);

const get = (path, token) =>
  fetch(BASE + path, {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  }).then(j);

const g = (n) => Number(n || 0).toFixed(3);
const r = (n) => Number(n || 0).toFixed(2);

let failures = 0;
function check(label, actual, expected, tol) {
  const ok = Math.abs(Number(actual) - Number(expected)) <= (tol ?? 0.01);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: got ${actual}, expected ${expected}`);
}

(async () => {
  // ---- login -------------------------------------------------------------
  const sent = await post('/login/send-otp', { phone: '1234567890' });
  const verified = await post('/login/verify-otp', {
    phone: '1234567890',
    otp: '123456',
    sessionId: sent.sessionId,
    fullhash: sent.fullhash,
  });
  const token = verified.token;
  if (!token) throw new Error('login failed: ' + JSON.stringify(verified).slice(0, 300));
  console.log('logged in\n');

  // ---- retailer ----------------------------------------------------------
  const cust = await post('/customer', { name: 'E2E Dues Retailer ' + Date.now(), phone: '9' + Date.now().toString().slice(-9) }, token);
  const customerId = cust?.data?._id || cust?.data?.id || cust?._id || cust?.id;
  if (!customerId) throw new Error('customer create failed: ' + JSON.stringify(cust).slice(0, 400));
  console.log('retailer', customerId, '\n');

  // ---- advance order -----------------------------------------------------
  // 100 g at 99.50 with no wastage -> exactly 100.000 g of fine, at 10000/g,
  // so the order is worth Rs.10,00,000. GST at 0.05% puts a clean Rs.500 on
  // the cash account, which is now the only thing that lands there.
  //   metal account = 100.000 g of 99.50
  //   cash  account = Rs.500 (GST only)
  const order = await post('/orders', {
    customerId,
    paymentMode: 'advance',
    includeGST: true,
    gstRate: 0.05,
    bookingRate: 10000,
    items: [{ itemName: 'Test Chain', weight: 100, purity: 99.5, wastage: 0, rate: 10000 }],
  }, token);
  const o0 = order?.data || order;
  const orderId = o0?._id || o0?.id;
  if (!orderId) throw new Error('order create failed: ' + JSON.stringify(order).slice(0, 500));

  console.log('1) fresh advance order — nothing paid');
  check('metal owed (gm)', g(o0.remainingWeight), '100.000');
  check('cash owed (Rs)', r(o0.outstandingCash), '500.00');
  check('status pending', o0.status === 'pending' ? 1 : 0, 1);

  // ---- pay in GOLD: 40 gm of 100% fine -----------------------------------
  const p1 = await post(`/orders/${orderId}/payments`, {
    amount: 0, goldRate: 0, goldWeight: 40, goldPurity: 99.5, notes: 'metal',
  }, token);
  const o1 = p1?.data || p1;
  console.log('\n2) retailer pays 40.000 gm in METAL');
  check('metal owed (gm)', g(o1.remainingWeight), '60.000');
  check('cash owed (Rs)', r(o1.outstandingCash), '500.00', 0.01);
  check('cash received (Rs)', r(o1.totalPaid), '0.00');

  // ---- pay in GOLD at 91.6% purity: 10 gm gross -> 9.16 fine -------------
  const p2 = await post(`/orders/${orderId}/payments`, {
    amount: 0, goldRate: 0, goldWeight: 10, goldPurity: 91.6, notes: '22K metal',
  }, token);
  const o2 = p2?.data || p2;
  console.log('\n3) pays 10.000 gm gross at 91.6% -> 9.178 gm of 99.50');
  check('metal owed (gm)', g(o2.remainingWeight), '50.822');
  check('cash owed (Rs)', r(o2.outstandingCash), '500.00');

  // ---- pay CASH against the CHARGES account ------------------------------
  const p3 = await post(`/orders/${orderId}/payments`, {
    amount: 200, goldRate: 0, settles: 'cash', notes: 'towards making',
  }, token);
  const o3 = p3?.data || p3;
  console.log('\n4) pays Rs.200 CASH against charges');
  check('metal owed (gm)', g(o3.remainingWeight), '50.822');   // untouched
  check('cash owed (Rs)', r(o3.outstandingCash), '300.00');
  check('cash received (Rs)', r(o3.totalPaid), '200.00');

  // ---- pay CASH against METAL: Rs.100,000 at 10000/gm = 10 gm ------------
  const p4 = await post(`/orders/${orderId}/payments`, {
    amount: 100000, goldRate: 10000, settles: 'metal', notes: 'buys metal',
  }, token);
  const o4 = p4?.data || p4;
  console.log('\n5) pays Rs.1,00,000 CASH against metal at 10000/gm');
  check('metal owed (gm)', g(o4.remainingWeight), '40.822');
  check('cash owed (Rs)', r(o4.outstandingCash), '300.00');    // untouched
  check('still pending', o4.status === 'pending' ? 1 : 0, 1);

  // ---- clear the METAL only; order must NOT complete ---------------------
  const p5 = await post(`/orders/${orderId}/payments`, {
    amount: 0, goldRate: 0, goldWeight: 40.822, goldPurity: 99.5, notes: 'clears metal',
  }, token);
  const o5 = p5?.data || p5;
  console.log('\n6) metal cleared, charges still open — must stay OPEN');
  check('metal owed (gm)', g(o5.remainingWeight), '0.000');
  check('cash owed (Rs)', r(o5.outstandingCash), '300.00');
  check('status still pending', o5.status === 'pending' ? 1 : 0, 1);

  // ---- clear the CASH too; now it completes -------------------------------
  const p6 = await post(`/orders/${orderId}/payments`, {
    amount: 300, goldRate: 0, settles: 'cash', notes: 'clears charges',
  }, token);
  const o6 = p6?.data || p6;
  console.log('\n7) charges cleared too — now it completes');
  check('metal owed (gm)', g(o6.remainingWeight), '0.000');
  check('cash owed (Rs)', r(o6.outstandingCash), '0.00');
  check('status completed', o6.status === 'completed' ? 1 : 0, 1);

  // ---- rejects an empty payment -----------------------------------------
  const bad = await post(`/orders/${orderId}/payments`, { amount: 0, goldRate: 0 }, token);
  console.log('\n8) a payment of nothing is rejected');
  const rejected = bad?.success === false || !!bad?.message || !!bad?.errors;
  check('rejected', rejected ? 1 : 0, 1);

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exitCode = failures === 0 ? 0 : 1;
})().catch(e => { console.error('ERROR', e.message); process.exitCode = 1; });
