import mongoose, { Schema } from "mongoose";
import type { Order, AdvancePayment } from "./order.types";
import {
    priceLine,
    totalFine995,
    priceInboundMetal,
    SETTLEMENT_FINENESS,
} from "../../common/utils/goldPricing";

/**
 * Grams below which an advance order counts as fully settled.
 *
 * weightPaid/remainingWeight deliberately carry full float precision so the
 * rupee figures derived from them stay exact (see the pre-save hook). That also
 * removed the incidental snap-to-zero that .toFixed(3) used to provide: a final
 * payment can now leave remainingWeight at ~1e-13 rather than 0, which would
 * keep an order Pending forever while every screen renders "0.000 gm".
 *
 * 0.0005 gm is the smallest weight that still displays as non-zero at the
 * 3-decimal precision used throughout the UI, so comparing against it
 * reproduces the previous behaviour without putting the rounding back into the
 * stored value.
 */
export const WEIGHT_SETTLED_EPSILON_GM = 0.0005;

/**
 * Rupees-per-gram below which two rates are the same rate.
 *
 * Used to decide whether a stored payment rate still matches the rate its
 * order was carrying, which is how an edit tells an auto-derived rate apart
 * from one a shopkeeper typed by hand. Rates are whole or near-whole rupees,
 * so anything under a paisa is float noise rather than a different rate.
 */
export const RATE_EPSILON = 0.001;

/**
 * Weighted-average rate across an order's items (Σ netWt·rate / Σ netWt) — the
 * same "effective rate" the create-order screen shows, so client and server
 * agree on what a multi-item order's single rate is.
 *
 * Exported because the pre-save hook and the edit path must not each carry
 * their own copy: the whole class of bug this module keeps producing is two
 * routes computing the same figure slightly differently.
 */
export function weightedItemRate(items: any, fallbackRate: any = 0): number {
    const list: any[] = Array.isArray(items) ? items : [];
    const totalNetWt = list.reduce((s, i) => s + (Number(i.weight) || 0), 0);
    if (totalNetWt <= 0) return Number(fallbackRate) || 0;
    return (
        list.reduce(
            (s, i) =>
                s +
                (Number(i.weight) || 0) *
                (Number(i.rate) || Number(fallbackRate) || 0),
            0,
        ) / totalNetWt
    );
}

const AdvancePaymentSchema = new Schema<AdvancePayment>(
    {
        date: {
            type: Date,
            required: true,
            default: Date.now,
        },
        amount: {
            type: Number,
            required: true,
            min: 0,
        },
        goldRate: {
            type: Number,
            required: true,
            min: 0,
        },
        weightCovered: {
            type: Number,
            required: true,
            min: 0,
        },
        paymentType: {
            type: String,
            enum: ["advance", "final", "credit"],
            default: "advance",
        },
        notes: {
            type: String,
            trim: true,
        },

        // Metal handed over as this payment. A retailer settles in gold, cash,
        // or both, so `amount` and `goldWeight` can both be set on one payment.
        goldWeight: {
            type: Number,
            required: false,
            min: 0,
        },
        goldPurity: {
            type: Number,
            required: false,
            min: 0,
            max: 100,
        },
        // Derived in the pre-save hook from goldWeight and goldPurity.
        fineWeight: {
            type: Number,
            required: false,
            default: 0,
            min: 0,
        },
        // Which account the CASH on this payment settles — see AdvancePayment
        // in order.types.ts. Defaults to "metal", the advance-booking meaning
        // cash has always had here.
        settles: {
            type: String,
            required: false,
            enum: ["metal", "cash"],
            default: "metal",
        },
    },
    { _id: true }
);

const OrderItemSchema = new Schema(
    {
        itemName: {
            type: String,
            required: true,
            trim: true,
        },

        // As weighed, in grams. NOT what the retailer is charged for — see the
        // pre-save hook, which runs this through the purity uplift and wastage
        // to reach a fine-99.50 weight.
        weight: {
            type: Number,
            required: true,
            min: 0,
        },

        // Purity as entered, in percent: 91.6 for 22K, not the string "22K".
        // The wholesaler's uplift is applied on top (goldPricing.chargedPurity)
        // and is never stored here — this stays what the metal actually is.
        purity: {
            type: Number,
            required: true,
            min: 0,
            max: 100,
        },

        // Wastage / Tunch, in percent. ADDED to the charged purity rather than
        // multiplied against the fine weight; on 100 g at 92 with 8% wastage
        // that is 100.000 g against 99.360 g.
        wastage: {
            type: Number,
            required: false,
            default: 0,
            min: 0,
        },

        // Rupees per gram of 99.50 fine — the only rate this product quotes.
        rate: {
            type: Number,
            required: false,
            min: 0,
            default: 0,
        },

        // Derived in the pre-save hook. Stored so a bill can be reprinted, and
        // a dispute answered, without re-deriving from rules that may have
        // moved since.
        chargedPurity: { type: Number, required: false, min: 0 },
        fine999: { type: Number, required: false, min: 0 },
        fine995: { type: Number, required: false, min: 0 },

        // Photos of the item being made/sold. Mirrors InvoiceItemSchema.photos.
        photos: {
            type: [
                {
                    url: { type: String, required: true, trim: true },
                    fileId: { type: String, required: true, trim: true },
                },
            ],
            required: false,
            default: undefined,
        },
    },
    // No per-item _id: photos are addressed by index, the order the client sent.
    { _id: false }
);

const OrderSchema = new Schema<Order>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            required: true,
            index: true,
            ref: "Dukandar",
        },

        customerId: {
            type: Schema.Types.ObjectId,
            required: true,
            ref: "Customer",
            index: true,
        },

        dukandarId: {
            type: Schema.Types.ObjectId,
            required: false,
            ref: "Dukandar",
            index: true,
        },

        orderNumber: {
            type: String,
            required: true,
        },

        orderDate: {
            type: Date,
            required: true,
            default: Date.now,
        },

        items: {
            type: [OrderItemSchema],
            required: true,
            default: [],
        },

        totalWeight: {
            type: Number,
            required: true,
            default: 0,
            min: 0,
        },

        paymentMode: {
            type: String,
            required: true,
            enum: ["complete", "advance"],
            default: "advance",
        },

        payments: {
            type: [AdvancePaymentSchema],
            required: true,
            default: [],
        },

        totalPaid: {
            type: Number,
            required: true,
            default: 0,
            min: 0,
        },

        weightPaid: {
            type: Number,
            required: true,
            default: 0,
            min: 0,
        },

        // The METAL account: grams still owed. See order.types.ts.
        remainingWeight: {
            type: Number,
            required: true,
            min: 0,
        },

        /**
         * Grams of excess already converted into retailer credit.
         *
         * Paying more than an order comes to leaves `remainingWeight` at 0 and
         * the surplus with nowhere to go — it used to be silently discarded.
         * The surplus is now credited to the retailer's held cash, and this
         * records how much of it has been, so a second save of the same order
         * cannot credit the same rupees twice.
         *
         * In GRAMS rather than rupees because that is the unit the surplus
         * arises in; the rupee figure is derived from it at the order's rate.
         */
        creditedExcessWeight: {
            type: Number,
            required: true,
            default: 0,
            min: 0,
        },

        // Cash received against the charges account.
        cashPaid: {
            type: Number,
            required: true,
            default: 0,
            min: 0,
        },

        // The CASH account: rupees still owed, held apart from the metal.
        outstandingCash: {
            type: Number,
            required: true,
            default: 0,
            min: 0,
        },

        estimatedBalance: {
            type: Number,
            required: true,
            default: 0,
            min: 0,
        },
        estimatedMakingCharges: {
            type: Number,
            required: false,
            default: 0,
        },
        bookingRate: {
            type: Number,
            required: false,
            default: 0,
        },
        amount: {
            type: Number,
            required: false,
            default: 0,
        },
        initialTotalWeight: {
            type: Number,
            required: false,
            default: 0,
        },

        // Default false, NOT true: orders created before this field existed
        // have no `includeGST` stored, and Mongoose applies schema defaults
        // on hydrate for any missing path — so a `true` default here would
        // silently start adding GST to already-pending orders' balance the
        // next time they're saved (e.g. a customer's next installment
        // payment), which never happened before. New orders always pass
        // includeGST explicitly at creation (order.service.ts), so this
        // default only ever applies to pre-existing orders.
        includeGST: {
            type: Boolean,
            required: true,
            default: false,
        },
        // Off unless the shopkeeper turns it on, and off for every order that
        // predates the field.
        includeItemPhotosOnBill: {
            type: Boolean,
            required: false,
            default: false,
        },
        gstRate: {
            type: Number,
            required: false,
            default: 3,
        },
        subTotal: {
            type: Number,
            required: false,
            default: 0,
        },
        gstAmount: {
            type: Number,
            required: false,
            default: 0,
        },

        status: {
            type: String,
            required: true,
            enum: ["pending", "completed", "cancelled"],
            default: "pending",
            index: true,
        },

        finalInvoiceId: {
            type: Schema.Types.ObjectId,
            ref: "Invoice",
        },

        completedAt: {
            type: Date,
        },

        deletedAt: {
            type: Date,
            default: null,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

// Index for efficient queries and uniqueness
OrderSchema.index({ userId: 1, orderNumber: 1 }, { unique: true });
OrderSchema.index({ userId: 1, status: 1, createdAt: -1 });
OrderSchema.index({ customerId: 1, status: 1 });

// Pre-save middleware to calculate totals
OrderSchema.pre("save", function (this: any) {
    // Calculate total weight from items if not manually set (though usually handled by items)
    if (this.items && this.items.length > 0) {
        // The METAL account is denominated in fine 99.50, not in the
        // ornaments' own grams — that is the unit every payment, melt credit
        // and settlement is expressed in. Summing raw weights here would put
        // the account in one unit and everything drawn against it in another.
        this.totalWeight = totalFine995(this.items as any);
    }

    // Sort payments by date to ensure history is chronological
    if (this.payments && this.payments.length > 1) {
        this.payments.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }

    const paymentsArr = this.payments || [];

    // Metal handed over, converted to the 99.50 the account is denominated in.
    //
    // Through priceInboundMetal, not a plain purity multiply: that gives a 99.9
    // figure, and crediting it straight against a 99.50 account silently
    // shortchanges the retailer by ~0.2% of every gram they hand over. Purity
    // defaults to settlement fineness so metal recorded without one is taken as
    // already-fine rather than discounted to nothing.
    paymentsArr.forEach((payment: any) => {
        payment.fineWeight = payment.goldWeight
            ? priceInboundMetal(payment.goldWeight, payment.goldPurity ?? SETTLEMENT_FINENESS)
            : 0;
    });

    // totalPaid stays CASH ONLY. Old gold given against the order settles part
    // of it, but no money changed hands for that part — folding it in here would
    // report a larger sum received than the shop actually took, and would blur
    // the purchase leg the profit work needs to see separately. Metal handed
    // over as a payment is excluded for the same reason.
    this.totalPaid = Number(paymentsArr.reduce(
        (sum: number, payment: any) => sum + (payment.amount || 0),
        0
    ).toFixed(3));

    // Of that cash, the part aimed at the charges account rather than at metal.
    this.cashPaid = Number(paymentsArr.reduce(
        (sum: number, payment: any) =>
            sum + (payment.settles === "cash" ? (payment.amount || 0) : 0),
        0
    ).toFixed(3));

    // Deliberately NOT rounded. Every rupee figure the app shows for a pending
    // advance order is derived as `remainingWeight * rate`, so quantizing grams
    // here quantizes money: a 0.0005 gm rounding becomes ~Rs.7 at current gold
    // rates. That is what made an order taken at Rs.14,450/gm report an
    // outstanding of Rs.11,68,495 on screen while the printed bill — which
    // subtracts cash from cash (grandTotal - totalPaid) — correctly said
    // Rs.11,68,500. Carrying full precision makes the two agree by algebra:
    // (totalWeight - amount/rate) * rate === totalWeight*rate - amount.
    // Display layers already format with .toFixed(3); rounding belongs there.
    // Cash aimed at metal, expressed as the grams it bought. Payments that
    // settle the charges account are excluded — that money clears making and
    // GST and never becomes metal, so counting its weightCovered here would
    // pay the same rupee down twice, once against each account.
    const weightFromPayments = paymentsArr.reduce(
        (sum: number, payment: any) =>
            sum + (payment.settles === "cash" ? 0 : (payment.weightCovered || 0)),
        0
    );

    // Metal handed over directly, already reduced to fine grams above.
    const weightFromMetal = paymentsArr.reduce(
        (sum: number, payment: any) => sum + (payment.fineWeight || 0),
        0
    );

    const weightedRate = weightedItemRate(this.items, this.bookingRate);

    this.weightPaid = weightFromPayments + weightFromMetal;

    // Calculate remaining weight
    this.remainingWeight = Math.max(0, (this.totalWeight || 0) - (this.weightPaid || 0));

    // If bookingRate is not set, try to get it from the first payment
    if (!this.bookingRate && this.payments && this.payments.length > 0) {
        const sorted = [...this.payments].sort((a: any, b: any) =>
            new Date(a.date).getTime() - new Date(b.date).getTime()
        );
        this.bookingRate = Number(sorted[0].goldRate.toFixed(3));
    }

    // Each line priced through the one implementation of the wholesale chain:
    // purity uplifted, wastage added to it, the result taken to fine 99.50.
    // See goldPricing.ts — and never inline any part of it here, because the
    // app mirrors that module for live preview and the two must agree exactly.
    //
    // The derived figures are written back onto the item so a bill can be
    // reprinted, and a dispute answered, without re-deriving from rules that
    // may have moved since.
    let totalGoldValue = 0;
    if (this.items && this.items.length > 0) {
        for (const it of this.items as any[]) {
            const priced = priceLine({
                weight: it.weight || 0,
                purity: it.purity || 0,
                wastage: it.wastage || 0,
            });

            it.chargedPurity = priced.chargedPurity;
            it.fine999 = priced.fine999;
            it.fine995 = priced.fine995;

            const rate = it.rate || this.bookingRate || 0;
            totalGoldValue += priced.fine995 * rate;
        }
    }

    // A wholesale line is metal and nothing else — no making charge, no other
    // charges, no discount. Wastage IS the labour, and it is already inside
    // the fine weight above rather than sitting beside it in rupees.
    const itemsSubtotal = totalGoldValue;
    this.estimatedMakingCharges = 0;

    const subtotalBeforeGst = Math.max(0, itemsSubtotal);
    const gstAmount = this.includeGST ? subtotalBeforeGst * ((this.gstRate ?? 3) / 100) : 0;
    const totalAmount = subtotalBeforeGst + gstAmount;

    this.subTotal = Number(subtotalBeforeGst.toFixed(3));
    this.gstAmount = Number(gstAmount.toFixed(3));

    this.amount = Number(totalAmount.toFixed(3));

    // Everything on an item that is not the metal itself: making, other charges
    // and discounts are properties of the order, not of the weight still owed.
    const nonGoldCharges = itemsSubtotal - totalGoldValue;

    // The CASH account. Making, other charges and GST are owed as money, so
    // they are held here rather than converted into grams and folded into the
    // metal account. A retailer can clear their metal and still owe charges, or
    // the reverse — the two settle independently.
    //
    // A full-payment order is settled when it is raised, by definition, so only
    // an advance order can carry either balance.
    const cashCharges = nonGoldCharges + gstAmount;
    this.outstandingCash =
        this.status === "completed" || this.paymentMode !== "advance"
            ? 0
            : Number(Math.max(0, cashCharges - (this.cashPaid || 0)).toFixed(3));

    // Calculate estimated balance
    if (this.status === "completed") {
        this.estimatedBalance = 0;
    } else if (this.paymentMode === "advance") {
        // An advance order settles in WEIGHT, not rupees: every payment locked
        // grams at the rate of the day it was taken. Pricing the whole order at
        // today's rate and subtracting the cash received throws that lock away
        // and bills the customer for appreciation they had already paid for —
        // on a two-payment order taken months apart that was worth Rs.20,000+.
        //
        // Deriving it from remainingWeight is also exactly what the order screen
        // does, so the screen, the printed bill and this stored value are now one
        // number instead of three formulas that agreed only while every rate on
        // the order happened to be identical.
        //
        // The epsilon applies to the METAL only. Metal being settled no longer
        // means the order is settled — the charges account can still be open —
        // so a sliver of leftover weight is dropped here without zeroing the
        // whole balance the way it used to.
        const metalOutstanding =
            this.remainingWeight < WEIGHT_SETTLED_EPSILON_GM ? 0 : this.remainingWeight;

        // The two accounts priced as one figure. `outstandingCash` already
        // carries the charges net of anything paid against them, so GST is not
        // added again here: it is quoted on the total at the booking rate and
        // lives in that account from the moment the order is raised.
        this.estimatedBalance = Number(
            (metalOutstanding * weightedRate + this.outstandingCash).toFixed(3),
        );
    } else {
        this.estimatedBalance = Number(Math.max(0, totalAmount - (this.totalPaid || 0)).toFixed(3));
    }
});

export const OrderModel = mongoose.model<Order>("Order", OrderSchema);
