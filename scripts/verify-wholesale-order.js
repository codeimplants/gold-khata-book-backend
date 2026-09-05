// Live-API regression check. Needs the server and MongoDB running
// (../start.cmd), and logs in with the store-review test number so it
// never spends SMS quota.
const BASE = 'http://localhost:7100/api';
const j = async r => { const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t.slice(0,400) }; } };
const post = (p,b,tk) => fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json',...(tk?{Authorization:'Bearer '+tk}:{})},body:JSON.stringify(b)}).then(j);

let fail = 0;
const eq = (l,g,w) => { const ok = String(g)===String(w); if(!ok) fail++; console.log(`  ${ok?'PASS':'FAIL'}  ${l}: got ${g}, want ${w}`); };

(async () => {
  const s = await post('/login/send-otp',{phone:'1234567890'});
  const v = await post('/login/verify-otp',{phone:'1234567890',otp:'123456',sessionId:s.sessionId,fullhash:s.fullhash});
  const token = v.token;

  const c = await post('/customer',{name:'Wholesale E2E '+Date.now(),phone:'9'+Math.floor(Math.random()*1e9).toString().padStart(9,'0')},token);
  const cid = c?.data?._id || c?.data?.id;

  // The wholesaler's own worked example, as a real order.
  const o = await post('/orders',{
    customerId: cid, paymentMode:'advance', includeGST:false, bookingRate:15450,
    items:[{ itemName:'Chain', weight:10.365, purity:91.6, wastage:4, rate:15450 }],
  }, token);
  const ord = o?.data || o;
  if (!ord?._id && !ord?.id) throw new Error('create failed: '+JSON.stringify(o).slice(0,400));

  console.log('order priced from 10.365 g @ 91.6% + 4% Tunch');
  const it = ord.items[0];
  eq('charged purity', it.chargedPurity, 92);
  eq('fine 99.9',  Number(it.fine999).toFixed(3), '9.950');
  eq('fine 99.50', Number(it.fine995).toFixed(3), '10.000');
  eq('order metal position (99.50 g)', Number(ord.totalWeight).toFixed(3), '10.000');
  eq('metal owed', Number(ord.remainingWeight).toFixed(3), '10.000');
  eq('order value @ 15450', Number(ord.amount).toFixed(2), '154500.00');
  eq('cash owed (no GST)', Number(ord.outstandingCash).toFixed(2), '0.00');

  console.log('');
  console.log('same order with 3% GST');
  const o2 = await post('/orders',{
    customerId: cid, paymentMode:'advance', includeGST:true, gstRate:3, bookingRate:15450,
    items:[{ itemName:'Chain', weight:10.365, purity:91.6, wastage:4, rate:15450 }],
  }, token);
  const ord2 = o2?.data || o2;
  eq('metal owed', Number(ord2.remainingWeight).toFixed(3), '10.000');
  eq('cash owed = GST only', Number(ord2.outstandingCash).toFixed(2), (154500*0.03).toFixed(2));

  console.log('');
  console.log('24K settlement metal is not uplifted');
  const o3 = await post('/orders',{
    customerId: cid, paymentMode:'advance', includeGST:false, bookingRate:15450,
    items:[{ itemName:'Fine bar', weight:10, purity:99.5, wastage:0, rate:15450 }],
  }, token);
  const ord3 = o3?.data || o3;
  eq('10 g of 99.50 stays 10 g', Number(ord3.remainingWeight).toFixed(3), '10.000');

  console.log('');
  console.log(fail === 0 ? 'ALL PASSED' : fail + ' FAILED');
  process.exitCode = fail === 0 ? 0 : 1;
})().catch(e => { console.error('ERROR', e.message); process.exitCode = 1; });
