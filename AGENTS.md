# Gold Khata Book — Backend

Read this before changing anything. It is the short version of what this
service is for and which parts will bite you.

> **Work in progress:** the app is being reworked to pass App Store guideline
> 4.3(a). The plan and progress log are in the frontend repo:
> `../gold-khata-book-frontend/APP_STORE_4.3_REWORK.md`. It includes the
> production demo account App Review signs in with.

## What this is

The API behind **Gold Khata Book**, a khata (ledger) app for **gold
wholesalers**. A wholesaler sells ornaments to **retailers** — jewellery shops —
and carries their running account until it is settled.

It is a fork of `sonebill-backend`, which was a **retail** billing app for
jewellery shops selling to walk-in consumers. Most of the code is still that
code. When something reads as retail — declarations, affidavits, walk-in
customers — it is inherited, and either already gone or not yet renamed.

**The domain rules live at
<https://claude.ai/code/artifact/3a6e7d0d-5bef-49d4-a523-869ac65bb4ef>.**
Read that before touching pricing or balances; the rest of this file assumes it.

## The one rule that matters

**Everything is denominated in grams of fine gold at 99.50.** Not the
ornament's own weight, not rupees. Cash is a way of settling that position at
the day's 24K 99.50 rate, not a second unit of account.

If you find yourself adding a rupee field that represents metal, or a gram
field that has already been priced, stop — that is the mistake this model
exists to prevent.

## Pricing: `src/common/utils/goldPricing.ts`

The whole chain, both directions, in one file. It is covered by
`npm run verify:pricing`, which asserts the wholesaler's own worked examples.
**Run it after any change there.** If the numbers move, the arithmetic moved,
and someone is being over- or under-charged.

Three things in it are counter-intuitive and all three are deliberate:

- `chargedPurity` is `floor(purity) + 1`, **not** `Math.ceil`. 18K is exactly
  75 and still becomes 76. It stops at 23K — 99.50 settlement metal is never
  uplifted, or every payment made in pure gold is overcharged ~0.5%.
- **Wastage is added to the purity**, not multiplied against the fine weight.
  On 100 g at 92 with 8% wastage that is 100.000 g against 99.360 g.
- `fine999` is rounded to 3dp **before** the 99.50 conversion, because that is
  the figure written on the bill and the khata is reconciled by hand against
  what is written.

**Outbound and inbound are deliberately not symmetric.** Selling uplifts
purity, adds wastage and converts at the exact ratio; buying takes purity as
found, applies no wastage and converts at a flat +10 mg per 5 g. That spread is
the wholesaler's margin. The instinct is to share one conversion helper between
both directions — doing that silently hands the margin back on every lot.

## Orders: `src/modules/order/`

An order carries **two independent balances**, and they settle separately:

| field | account | unit |
| --- | --- | --- |
| `remainingWeight` | metal | grams |
| `outstandingCash` | cash | rupees |

`estimatedBalance` is **both of them priced as one rupee figure**
(`remainingWeight × rate + outstandingCash`). It is for printing and for "what
would close this today". **Never add it to either account** — that double-counts
the metal, which is a bug that already shipped once.

A payment (`AdvancePayment`) can carry cash and metal at the same time, because
a retailer settles in either or both. `settles` says which account the *cash*
half clears — `"metal"` buys gold down at `goldRate`, `"cash"` clears charges.
It defaults to `"metal"`, which is what an advance payment has always meant here.

`addPayment` only completes an order when **both** accounts are clear.
Completing on settled metal alone would close orders that still owe charges,
and completion zeroes both balances — so the debt would not be hidden, it would
be erased.

## Held money: `src/modules/retailerAccount/`

What a retailer has left with the wholesaler that is **not against any sale**,
per retailer, as entries plus two balances recomputed from them on every save:

| field | what | in by | out by |
| --- | --- | --- | --- |
| `heldCash` | rupees, rate NOT fixed | `POST /:id/cash` (cash with the rate to be fixed later, or a cash advance); an order's overpayment (`creditOverpayment`, linked by `orderId`) | `POST /:id/cash/allocate` at the rate the retailer names on the day, never an old rate; `/cash/refund` |
| `meltCredit` | grams of 99.50, ALL gold held | a melt lot (`/melt`); a gold advance (`POST /:id/gold` {weight, purity}, entry `gold-received`, credited with `priceInboundMetal`) | `POST /:id/melt/apply` gram for gram; `/melt/payout` |

`meltCredit` kept its name when gold advances joined it, because it is the wire
format the apps read. `GET /retailer-account` lists every account with entries
(the app's home totals and day book).

Held money is shown BESIDE dues and never netted off them: netting hides that
the wholesaler is holding the retailer's money. Payments that `allocate` and
`apply` post on an order carry `paymentType: "credit"` (allowed on invoices
too), so a day book can tell money that moved from the account from money
handed over that day.

## What was removed, and why it is not coming back

The old-gold **declaration** machinery is gone: affidavits, ID proof,
witnesses, signature capture, `POG-n` numbering, the whole `purchaseOldGold`
module. That was consumer protection law for buying gold off the public. It has
no place between a wholesaler and a retailer.

**Ornament exchange** is gone too — `ornamentExchanges`, `exchangeWeightCovered`,
`exchangeExcess`. A retailer handing over metal is a payment in gold, which the
payment model already covers. Two ways to record the same event reported
differently.

Melting old metal *is* coming back, as its own record with photos for audit —
but as a melt lot producing a credit, never as a declaration.

## Running it

```
npm run dev              # ts-node-dev, port from .env
npm run verify:pricing   # the pricing chain against its worked examples
npm run lint
npx tsc --noEmit
```

MongoDB is **self-hosted**, not Atlas — both environments are `mongodb://`. It
must be a **single-node replica set**, not a standalone: `unifiedCompleteAdvanceOrder`
in `src/modules/order/order.service.ts` opens a real multi-document transaction,
and a standalone `mongod` rejects those with "Transaction numbers are only
allowed on a replica set member or mongos". Everything else works fine on a
standalone, so this fails only on order completion — in production, on a real
sale.

Server ports are **7110 (prod) / 7111 (dev)**. Not 7100/7101: those belong to
`goldrate-backend`, which was already running on the shared box. 7112 is left
free for a preprod that does not currently exist — `src/config/db.ts` still
accepts `NODE_ENV=preprod`, but nothing is deployed for it.

`.env` is gitignored. JWT secrets are this product's own — SoneBill tokens do
not authenticate here, which is intended. The 2Factor SMS account **is** shared
with SoneBill, by decision, and **dev sends real SMS**: the dev-only local-OTP
bypass was removed so that one OTP path serves every environment. Log in with
`1234567890` / `123456` to avoid spending quota.

## Conventions worth keeping

- Comments here explain **why**, usually citing the incident that produced the
  rule. When you change such code, restate the reasoning — do not delete it.
- Money and weight arithmetic belongs on the server. The app mirrors some of it
  for live preview; the server stays authoritative.
- Weights carry full float precision in storage and are rounded for display.
  `WEIGHT_SETTLED_EPSILON_GM` (0.0005 g) is what decides "settled", because a
  fully-paid order lands at ~1e-13 rather than 0.
