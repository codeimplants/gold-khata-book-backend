# Transaction Structure — Sell / Purchase Taxonomy

> **Status: proposal. Nothing in this document is built.**
>
> Goal right now: **get the structure right so profit reporting can be added later without rework.**
> Profit & loss itself is explicitly deferred — §6 records how it drops in, and nothing in §§1–5
> should be built in a way that blocks it.
>
> Decisions taken with the shop owner:
> - Old gold is **sold on to a merchant, not held as stock**
> - Transactions should be presented as two tabs: **Sell** and **Purchase**
> - The structure must be **expandable and backwards compatible**

---

## 1. The workflow this must model

The real sequence, which is not what a stock-holding jeweller does:

```
1. Customer brings old gold
2. Shopkeeper takes it to a merchant and SELLS it there      ← value realised here
3. Hours later, returns to the customer
4. Pays the customer that value minus his margin              ← or credits it against a new ornament
5. THEN creates the bill                                      ← merchant value already known
```

Two consequences that shape everything below:

**There is no inventory holding period.** The shop does not carry old gold as stock, so lot tracking,
weighted-average costing and FIFO are all unnecessary. An earlier draft of this document proposed
them; that was based on a wrong assumption and has been removed.

**The merchant's value is already known when the bill is created.** So both sides of the margin are in
hand at record time. Whenever profit reporting is added, it needs one extra captured number, not a
costing engine.

---

## 2. Every transaction has legs, not a single type

The organising idea. A transaction is described by which **legs** it has:

| | Sell leg | Purchase leg |
|---|---|---|
| Plain invoice | ✅ goods sold | — |
| **Exchange** (old for new) | ✅ goods sold | ✅ old gold acquired |
| Standalone old-gold purchase | — | ✅ old gold acquired |

An **exchange always has both legs**, whichever side is larger.

### 2.1 Why not categorise by cash direction

The obvious-looking alternative — file it under Purchase when the shop pays out, Sell when it
collects — breaks immediately:

- A ₹1,00,000 necklace against ₹90,000 of old gold → "Sell"
- The **same necklace** against ₹1,10,000 of old gold → "Purchase"

The category flips on the relative size of the two legs. The Purchase tab would fill with necklace
invoices and its total would mean nothing. A few thousand rupees either way would move a transaction
between tabs.

**Settlement direction is a payment attribute, not a transaction type.** Treating it as a field is
also what makes it expandable: "paid partly in cash and partly by transfer" becomes another value,
not another tab.

### 2.2 What this gives the two tabs

| Tab | Contains | Total means |
|---|---|---|
| **Sell** | every record with a sell leg — all invoices, exchanges included | value of goods sold |
| **Purchase** | every record with a purchase leg — standalone purchases **and** the old-gold leg of every exchange | value of old gold acquired |

An exchange appears in both. That is not duplication — it is both. And the totals stay additive:

```
Sell total − Purchase total = net cash movement
```

---

## 3. The shape to standardise on

Not a new collection. A **common projection** every transaction type can expose, so the two tabs, and
later any report, can treat them uniformly.

```ts
interface TransactionSummary {
  id: string;
  kind: 'sale' | 'exchange' | 'purchase';   // string enum — room for 'disposal', 'commission'
  date: string;
  number: string;                            // INV-… | DEC-…
  customerId: string;

  sellValue: number;                         // goods sold, ex-GST. 0 when none
  purchaseValue: number;                     // old gold acquired.  0 when none

  settlement: {
    direction: 'from_customer' | 'to_customer' | 'nil';
    amount: number;
    method?: 'cash' | 'online';
  };
}
```

Both tabs become trivial filters — `sellValue > 0`, `purchaseValue > 0` — and the shop-pays-customer
case is just `direction: 'to_customer'`, needing no special handling anywhere.

### 3.0 The four purchase sources — validated against the code

A shop buys from two kinds of counterparty, and the wholesaler side splits on GST:

| # | Source | Recorded by | State |
|---|---|---|---|
| 1 | Customer — old gold for cash | `OldGoldDeclaration` | ✅ built |
| 2 | Customer — old gold in exchange | `Invoice.ornamentExchanges` | ✅ exists |
| 3 | Wholesaler **with** GST | `Purchase` | ✅ exists |
| 4 | Wholesaler **without** GST | **also `Purchase`** | ✅ already supported |

**A separate non-GST purchase mechanism is not needed.** `purchase.schema.ts` makes `supplierGstin`
and `gstRate` optional and allows `gstAmount: 0`, and `purchase.types.ts` states the intent outright:
*"absent => unregistered supplier (ITC ineligible)"*. A zero-GST purchase from an unregistered seller
is already a first-class record. Any gap here is UI discoverability, not capability.

**"Add product" is NOT a purchase.** `catalogProduct` holds name, category, purity, making charges,
discount, gross weight and HUID — and no cost, supplier, date or quantity. It is a **billing
template**, a shortcut so item details need not be retyped per bill. Creating one records no money
and no stock. Routing purchases through it would produce inventory with no cost and no audit trail.

### 3.0.1 Known defect — `stockQty` is silently dropped

The mobile app sends `stockQty` when creating and updating a catalog product
(`dataSlice.ts:1529, 1609`), but the field exists **nowhere** in the backend catalogProduct model,
types or DTO. Mongoose's default `strict: true` discards it on write, so it returns `undefined`, and
the consumer then skips every product:

```js
if (!match || typeof match.stockQty !== 'number') continue;   // dataSlice.ts:2174
```

Consequence: the "Stock updated / X is now out of stock" alerts in `CreateInvoiceScreen` **can never
fire for a logged-in user**. Stock appears to work only in guest mode, where AsyncStorage keeps the
value locally. There is no error — stock simply never moves. Fix before anything depends on
inventory counts.

### 3.0.2 One entry point for every kind of shopkeeper

Shopkeepers sit on a spectrum, and the app must serve both ends from one place:

- **Billing only** — wants products purely as a picker when adding a bill line. No stock, no cost, no
  suppliers. Only goal is a customer bill (full or advance payment).
- **Full tracking** — wants stock in with and without GST, freedom to sell from stock or not, and
  every kind of purchase recorded so profit can be derived later.

**The pattern is already chosen and half-built.** The Add Product form carries a `Stock Qty` field
whose placeholder reads *"Blank = not tracked"* (`ItemsProductsScreen.tsx:674-681`). Behaviour is
driven by **what gets filled in, not by a mode the shopkeeper selects**. Extend that convention
rather than introducing a business-type setting.

| Filled in | Result | Serves |
|---|---|---|
| Name, purity, making charges | Billing template only | billing-only shop |
| + Stock Qty | Stock tracked, deducted on sale | partial |
| + Cost, supplier, date, GST | Purchase record → cost basis for profit | full tracking |

**One form, but two records.** The form must always create/update a **Product** (the recurring thing
sold, one row, reused across bills) and *additionally* a **Purchase** when cost details are entered
(an event, many per product over time). Merging them into one record breaks restocking: the second
delivery either overwrites the first cost — destroying the history profit depends on — or creates a
duplicate product that pollutes the item picker.

Selling from stock is already optional and needs no new concept: `BillItem.sourceItemId` links a bill
line to a catalog product and drives deduction (`dataSlice.ts:2168`). A free-typed line deducts
nothing, and a product with blank `stockQty` never deducts.

**Protect the simple case.** The billing-only shop is the majority. Cost, supplier and GST fields must
sit behind a default-collapsed disclosure so they are never encountered by someone who does not want
them. The risk in unifying is making the simple path worse in order to serve the complex one.

To finish the pattern: persist `stockQty` (see §3.0.1 — it is currently dropped), add the collapsed
cost section, give `Purchase` an optional `items[]` linking to products, and surface all inward
sources in one list.

### 3.1 Where the data already lives

| Leg | Source today | Gap |
|---|---|---|
| Sell value | `Invoice.subTotal` | none |
| Purchase value (exchange) | `Invoice.ornamentExchanges[].amount` | not surfaced as its own leg |
| Purchase value (standalone) | `OldGoldDeclaration.totalAmount` | not in any list view |
| Purchase value (wholesaler, ±GST) | `Purchase.taxableValue` | not in the customer-facing list views |
| Settlement | `Invoice.paymentMethod` / `OldGoldDeclaration.payout` | direction not modelled |

Whether the Purchase tab should show **wholesaler** purchases alongside customer ones is a product
decision, not a structural one — the projection covers both either way. Two tabs answer different
questions: "what did I buy from customers today" versus "everything the business bought". Worth
deciding before building, since it changes what the tab total means.

**No schema change is required to build the two tabs.** Everything needed is already stored; it is a
projection and a UI change. That is the point of doing structure first.

---

## 4. Backwards compatibility rules

1. **Every new field optional.** No existing model gains a required field.
2. **No new field with a default on an existing model.** Mongoose applies defaults *on hydrate*, so a
   defaulted field silently mutates old documents on their next save — the trap `order.model.ts`
   already documents for `includeGST`.
3. **Derive, don't migrate.** `TransactionSummary` is computed from what is already stored, so every
   historical invoice and declaration appears in the tabs with no backfill.
4. **Unknown is `null`, never `0`** — decisive once profit arrives; a fabricated zero cost reports
   100% margin.
5. **Additive API only.** Old app builds keep working; backend deploys before the app.

---

## 5. Expandability hooks

Deliberate room, none of it built now:

| Later need | Accommodated by |
|---|---|
| Selling scrap to a merchant as its own record | new `kind: 'disposal'` |
| Shop brokers a sale for commission | new `kind: 'commission'`, sell leg 0 |
| Shops that **do** hold stock | lot tracking hangs off the purchase leg; nothing here assumes immediate resale |
| Wholesaler purchases in the same view | `Purchase` module exposes the same projection |
| Split settlements | `settlement` is already an object |
| Silver, platinum | no metal assumption anywhere in the taxonomy |

---

## 6. Profit, when it comes (deferred)

Recorded so §§1–5 do not block it. **Do not build this yet.**

Because the merchant value is known before the bill exists, profit needs **one captured number**, not
a costing engine:

```
merchantRealisation   // what the merchant actually paid for the old gold
```

Added as an optional field on the purchase leg, it yields directly:

```
old-gold margin = merchantRealisation − purchaseValue
```

Worked example — exchange:

```
Sells   necklace  20 g 22K   metal ₹1,40,000 + making ₹15,000 = ₹1,55,000
Takes   old gold  15 g 22K   credited to customer               ₹1,02,000
Merchant paid the shopkeeper                                    ₹1,06,000
Customer pays                                                     ₹53,000

Sell leg     : revenue ₹1,55,000  (not ₹53,000)
Purchase leg : ₹1,02,000 out, ₹1,06,000 back  →  margin ₹4,000
```

This is why the legs must stay separate. Netted together it looks like a ₹53,000 sale. Split apart,
you can see whether a generous old-gold rate won a sale worth winning.

### 6.1 Three existing defects to fix at that point, not now

Found while reading `sales.service.ts`. All pre-date this work.

| # | Defect | Consequence |
|---|---|---|
| 1 | `totalSales` sums `totalAmount`, which **includes GST** (`sales.service.ts:57`) | Revenue overstated by tax collected for the government |
| 2 | Sales report filters `createdAt`; GST report filters `invoiceDate` | A back-dated invoice falls in **different months** in the two reports |
| 3 | Exchange credit is netted into the invoice total | An exchange reads as a smaller sale rather than a full sale plus a purchase |

Fix these *after* the tabs exist: correcting them will change numbers the owner is used to seeing, and
that is easier to explain alongside a view that shows why.

### 6.2 For the shop's CA — not ours to decide

- Selling old gold on to a merchant is likely a **taxable outward supply** and may belong in the GST
  report, which today knows only about invoices.
- Buying from an unregistered individual: RCM applicability and ITC eligibility.

The declaration module is deliberately excluded from both reports until these are answered.

---

## 7. Verification

- **Tab totals reconcile:** `Sell total − Purchase total = net cash` for any period.
- **An exchange appears in both tabs**, with the sell leg in one and the old-gold leg in the other —
  and is counted once in each, never twice in the same.
- **Direction does not change category:** an exchange where the shop pays out sits in exactly the same
  two tabs as one where it collects. Test both around the crossover point.
- **No backfill needed:** every historical invoice and declaration appears correctly, since the
  projection is derived from existing fields.
- **Old-client check:** the previous app build against the new backend, invoice creation unaffected.

---

## 8. Related

- `src/modules/oldGoldDeclaration/` — standalone purchases and the exchange declaration
- `src/modules/invoice/` — `ornamentExchanges` holds the exchange purchase leg
- `src/modules/sales/sales.service.ts` — where the three §6.1 defects live
- `dev-help/deploying-the-backend.md` — deployment
