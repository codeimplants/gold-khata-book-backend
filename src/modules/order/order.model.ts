import mongoose, { Schema } from "mongoose";
import type { Order, AdvancePayment } from "./order.types";

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
            enum: ["advance", "final"],
            default: "advance",
        },
        notes: {
            type: String,
            trim: true,
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
        itemType: {
            type: String,
            required: true,
            enum: ["Gold", "Silver"],
        },
        purity: {
            type: String,
            required: true,
        },
        weight: {
            type: Number,
            required: true,
            min: 0,
        },
        grossWeight: {
            type: Number,
            required: false,
            min: 0,
        },
        lessWeight: {
            type: Number,
            required: false,
            min: 0,
        },
        rate: {
            type: Number,
            required: false,
            min: 0,
            default: 0,
        },
        makingChargeType: {
            type: String,
            required: true,
            enum: ["Per Gram", "%", "Fix"],
        },
        makingChargeValue: {
            type: Number,
            required: true,
            min: 0,
        },
        chargeDescription: {
            type: String,
            required: false,
            trim: true,
        },
        chargeAmount: {
            type: Number,
            required: false,
            min: 0,
            default: 0,
        },
        discountType: {
            type: String,
            required: false,
            trim: true,
        },
        discount: {
            type: Number,
            required: false,
            min: 0,
            default: 0,
        },
        // Photos of the item being made/sold, so the shopkeeper can see months
        // later which piece this was. Mirrors InvoiceItemSchema.photos.
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

        remainingWeight: {
            type: Number,
            required: true,
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
        isOrnamentExchanges: {
            type: Boolean,
            required: true,
            default: false,
        },

        // Grams the old gold settled, derived in the pre-save hook from the
        // exchange value and the order's effective rate. Deliberately has NO
        // schema default: Mongoose applies defaults on hydrate, and a default
        // here would write a value onto legacy orders the moment they are next
        // saved for any reason. The hook sets it explicitly instead.
        exchangeWeightCovered: {
            type: Number,
            required: false,
            min: 0,
        },

        // Surplus when the old gold is worth more than the whole order — money
        // the shop owes the customer. Same no-default reasoning as above.
        exchangeExcess: {
            type: Number,
            required: false,
            min: 0,
        },

        // Photos of the old ornaments taken in against this order. They belong
        // to the acquisition, not to the declaration: a shopkeeper may photograph
        // the goods and never print a declaration, and a declaration written
        // later must be able to reuse them rather than ask for them again.
        ornamentPhotos: {
            type: [
                {
                    url: { type: String, required: true, trim: true },
                    fileId: { type: String, required: true, trim: true },
                },
            ],
            required: false,
            default: undefined,
        },
        // Off unless the shopkeeper turns it on, and off for every order that
        // predates the field.
        includeItemPhotosOnBill: {
            type: Boolean,
            required: false,
            default: false,
        },
        // Mixed, same as InvoiceSchema.ornamentExchanges — avoids Mongoose
        // casting older/differently-shaped rows on hydrate.
        ornamentExchanges: {
            type: Schema.Types.Mixed,
            required: false,
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
        this.totalWeight = Number(this.items.reduce(
            (sum: number, item: any) => sum + (item.weight || 0),
            0
        ).toFixed(3));
    }

    // Sort payments by date to ensure history is chronological
    if (this.payments && this.payments.length > 1) {
        this.payments.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }

    // totalPaid stays CASH ONLY. Old gold given against the order settles part
    // of it, but no money changed hands for that part — folding it in here would
    // report a larger sum received than the shop actually took, and would blur
    // the purchase leg the profit work needs to see separately.
    const paymentsArr = this.payments || [];
    this.totalPaid = Number(paymentsArr.reduce(
        (sum: number, payment: any) => sum + (payment.amount || 0),
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
    const weightFromPayments = paymentsArr.reduce(
        (sum: number, payment: any) => sum + (payment.weightCovered || 0),
        0
    );

    // Old gold settles WEIGHT, exactly as an advance payment does. Previously
    // the exchange only reduced the rupee subtotal further down, so an order
    // could be fully covered in money while still showing the customer owed the
    // full weight — the two halves of the same order disagreed.
    const exchangeValue = this.isOrnamentExchanges && Array.isArray(this.ornamentExchanges)
        ? (this.ornamentExchanges as any[]).reduce((sum, ex) => sum + (Number(ex?.amount) || 0), 0)
        : 0;

    const weightedRate = weightedItemRate(this.items, this.bookingRate);

    // Unrounded for the same reason as weightFromPayments above — old gold
    // settles weight, so its grams feed the same `remainingWeight * rate`
    // money math and carry the same rounding error into the balance.
    this.exchangeWeightCovered = weightedRate > 0
        ? exchangeValue / weightedRate
        : 0;

    this.weightPaid = weightFromPayments + this.exchangeWeightCovered;

    // Calculate remaining weight
    this.remainingWeight = Math.max(0, (this.totalWeight || 0) - (this.weightPaid || 0));

    // If bookingRate is not set, try to get it from the first payment
    if (!this.bookingRate && this.payments && this.payments.length > 0) {
        const sorted = [...this.payments].sort((a: any, b: any) =>
            new Date(a.date).getTime() - new Date(b.date).getTime()
        );
        this.bookingRate = Number(sorted[0].goldRate.toFixed(3));
    }

    // Per-item value: goldValue (netWt * item.rate) + making charge (by type)
    // + other charges - discount. Mirrors calculateItemValues/getItemComponents
    // in mobile's src/utils/calculations.ts so the persisted total matches what
    // the create-order screen shows the user.
    let itemsSubtotal = 0;
    let totalMaking = 0;
    let totalGoldValue = 0;
    if (this.items && this.items.length > 0) {
        for (const it of this.items as any[]) {
            const netWt = it.weight || 0;
            const grossWt = it.grossWeight ?? netWt;
            const rate = it.rate || this.bookingRate || 0;
            const makingValue = it.makingChargeValue || 0;

            let makingTotal = 0;
            if (it.makingChargeType === "%") {
                makingTotal = (grossWt * rate * makingValue) / 100;
            } else if (it.makingChargeType === "Per Gram") {
                makingTotal = grossWt * makingValue;
            } else {
                makingTotal = makingValue; // Fix
            }
            totalMaking += makingTotal;

            totalGoldValue += netWt * rate;

            const chargeAmount = it.chargeAmount || 0;
            const discount = it.discount || 0;
            const beforeDiscount = (netWt * rate) + makingTotal + chargeAmount;
            const discountValue = (it.discountType || "").toLowerCase() === "%" ||
                (it.discountType || "").toLowerCase() === "percentage" ||
                (it.discountType || "").toLowerCase() === "percent"
                ? (beforeDiscount * discount) / 100
                : discount;

            itemsSubtotal += Math.max(0, beforeDiscount - discountValue);
        }
    }
    this.estimatedMakingCharges = Number(totalMaking.toFixed(3));

    const subtotalBeforeGst = Math.max(0, itemsSubtotal - exchangeValue);
    const gstAmount = this.includeGST ? subtotalBeforeGst * ((this.gstRate ?? 3) / 100) : 0;
    const totalAmount = subtotalBeforeGst + gstAmount;

    this.subTotal = Number(subtotalBeforeGst.toFixed(3));
    this.gstAmount = Number(gstAmount.toFixed(3));

    // Old gold worth more than the whole order. The subtotal already clamps at
    // zero, so the surplus would otherwise vanish — record it explicitly as
    // money owed back to the customer rather than silently absorbing it.
    this.exchangeExcess = Number(Math.max(0, exchangeValue - itemsSubtotal).toFixed(3));

    this.amount = Number(totalAmount.toFixed(3));

    // Everything on an item that is not the metal itself: making, other charges
    // and discounts are properties of the order, not of the weight still owed.
    const nonGoldCharges = itemsSubtotal - totalGoldValue;

    // Calculate estimated balance
    if (this.status === "completed" || this.remainingWeight < WEIGHT_SETTLED_EPSILON_GM) {
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
        const balanceBeforeGst = Math.max(
            0,
            this.remainingWeight * weightedRate + nonGoldCharges,
        );

        // GST is quoted tentatively on the TOTAL cost of the item at the booking
        // rate — not on the balance alone. The advance is adjusted against a
        // gross invoice at final settlement, so the tax does not shrink just
        // because part of the order has already been paid for. `gstAmount` above
        // is exactly that figure, which is also what the create-order screen
        // shows, so the quote a customer sees before paying and the one they see
        // afterwards are the same number.
        this.estimatedBalance = Number(
            (balanceBeforeGst + gstAmount).toFixed(3),
        );
    } else {
        this.estimatedBalance = Number(Math.max(0, totalAmount - (this.totalPaid || 0)).toFixed(3));
    }
});

export const OrderModel = mongoose.model<Order>("Order", OrderSchema);
