import { Types } from "mongoose";

export interface AdvancePayment {
    _id?: Types.ObjectId;
    date: Date;
    amount: number;
    goldRate: number; // Rate per gram at the time of payment
    weightCovered: number; // Weight covered by this payment in grams
    paymentType?: "advance" | "final" | "credit";
    notes?: string;

    /**
     * Metal handed over as this payment, as weighed (gross grams).
     *
     * A retailer settles in gold, in cash, or in both, so one payment can carry
     * a rupee `amount` and a `goldWeight` at the same time.
     */
    goldWeight?: number;
    /** Purity of that metal in percent — 91.6 for 22K, 99.5 for 24K. */
    goldPurity?: number;
    /** Server-computed: goldWeight * goldPurity / 100. */
    fineWeight?: number;

    /**
     * Which account this payment's CASH settles.
     *
     * "metal" buys gold down at `goldRate` — the advance-booking behaviour,
     * where paying cash locks grams at the rate of the day. "cash" pays off the
     * charges account instead (making, other charges, GST), which is money owed
     * as money and never converts to metal.
     *
     * Defaults to "metal" because that is what an advance payment has always
     * meant here; a payment that is meant to clear charges has to say so.
     */
    /** "silver": the cash buys silver grams down at `goldRate`, which on such
     *  a payment is the silver rate per gram. It never touches the gold account. */
    settles?: "metal" | "cash" | "silver";

    /** Silver handed over as this payment, in grams, credited gram for gram. */
    silverWeight?: number;
}

export type OrderStatus = "pending" | "completed" | "cancelled";
export type PaymentMode = "complete" | "advance";

export interface OrderItem {
    /** Missing means gold: every line saved before silver existed is gold. */
    metal?: "gold" | "silver";
    itemName: string;
    /**
     * Gold: as weighed, in grams, not what the retailer is charged for.
     * Silver: the NET weight, which is exactly the grams owed.
     */
    weight: number;
    /** Gold only. Purity as entered, in percent — 91.6 for 22K. */
    purity?: number;
    /** Silver only: pieces, and the weights net was worked out from. */
    quantity?: number;
    grossWeight?: number;
    packetWeight?: number;
    /** Silver only, derived: net x rate. */
    silverValue?: number;
    /** Wastage / Tunch in percent, ADDED to the charged purity. */
    wastage?: number;
    /** Rupees per gram of 99.50 fine. */
    rate?: number;

    /** Derived server-side — see goldPricing.ts. Stored so a bill reprints. */
    chargedPurity?: number;
    fine999?: number;
    fine995?: number;

    /** Optional photos of the item being made/sold. */
    photos?: { url: string; fileId: string }[];
}

export interface Order {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    customerId: Types.ObjectId;
    dukandarId?: Types.ObjectId;

    orderNumber: string;
    orderDate: Date;

    // Items
    items: OrderItem[];

    // Aggregates (calculated or provided)
    totalWeight: number; // Total weight in grams

    // Payment mode
    paymentMode: PaymentMode;

    // Payment tracking
    payments: AdvancePayment[];
    totalPaid: number;
    weightPaid: number;
    /**
     * The METAL account: grams the retailer still owes.
     *
     * One of the two independent balances an order carries. Metal is owed as
     * metal — it is settled by handing gold back, or bought out with cash at an
     * agreed rate — so it is tracked in grams and never silently priced into
     * rupees. See `outstandingCash` for the other half.
     */
    remainingWeight: number;
    /** The SILVER account, in grams of silver, independent of the gold one. */
    totalSilverWeight?: number;
    silverWeightPaid?: number;
    remainingSilverWeight?: number;
    /** Grams of excess already turned into retailer credit — see the model. */
    creditedExcessWeight: number;
    /** Cash received against the charges account. */
    cashPaid: number;
    /**
     * The CASH account: rupees the retailer still owes.
     *
     * Making charges, other charges and GST are owed as money, not as metal,
     * so they are held apart from `remainingWeight` rather than converted into
     * grams. A retailer can owe metal and cash independently, and settling one
     * does not touch the other.
     */
    outstandingCash: number;
    /**
     * Both accounts expressed as one rupee figure, at today's rate:
     * `remainingWeight * rate + outstandingCash`.
     *
     * A convenience for printing and for "what would it cost to close this
     * today", NOT a third balance — adding it to either account double-counts.
     */
    estimatedBalance: number;
    estimatedMakingCharges?: number;
    bookingRate: number;
    amount?: number; // Total estimated value (Gold + Making + GST)
    initialTotalWeight?: number;

    includeGST: boolean;

    /**
     * Whether item photos are printed on the customer's copy. Off by default and
     * for every order predating the field — the photos are a shop-side record
     * first, and putting them on the customer's document is a separate choice.
     */
    includeItemPhotosOnBill?: boolean;
    gstRate?: number;
    subTotal?: number;
    gstAmount?: number;

    // Status
    status: OrderStatus;

    // Final settlement fields
    finalInvoiceId?: Types.ObjectId;
    completedAt?: Date;
    deletedAt: Date | null;

    createdAt: Date;
    updatedAt: Date;
}

export interface CreateOrderDTO {
    orderDate: Date;
    items: OrderItem[];
    paymentMode: PaymentMode;
    bookingRate?: number;
    includeGST?: boolean;
    gstRate?: number;
    /** Print item photos on the customer's copy. Defaults to false. */
    includeItemPhotosOnBill?: boolean;
    initialPayment?: {
        amount: number;
        goldRate: number;
        notes?: string;
    };
}

export interface AddPaymentDTO {
    /** Cash received. Zero when the retailer settled purely in metal. */
    amount: number;
    /** Rate the cash bought metal at. Not needed when `settles` is "cash". */
    goldRate: number;
    /** Metal received, as weighed (gross grams). */
    goldWeight?: number;
    /** Purity of that metal in percent. */
    goldPurity?: number;
    /** Silver received, in grams. */
    silverWeight?: number;
    /** Which account the cash settles — see AdvancePayment. */
    settles?: "metal" | "cash" | "silver";
    date?: Date;
    paymentType?: "advance" | "final" | "credit";
    notes?: string;
}

export interface UpdateOrderDTO {
    items?: OrderItem[];
    status?: OrderStatus;
}
