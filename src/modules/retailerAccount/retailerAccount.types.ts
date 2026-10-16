import { Types } from "mongoose";

/**
 * What a retailer has left with the wholesaler that is not yet against any
 * particular bill.
 *
 * Order balances answer "what does THIS bill still owe". This answers "what am
 * I holding for this retailer" — and the two are genuinely different questions,
 * because neither thing it holds belongs to one order:
 *
 *   - a retailer pays a lump sum that may cover several bills, or none yet
 *   - a melt lot produces a credit that may be split across bills, or taken
 *     as cash
 *
 * Both are stored unallocated and drawn down explicitly. Nothing here nets
 * itself against an order automatically: netting hides that the wholesaler is
 * holding someone else's money or metal, which is exactly what they need to
 * see plainly.
 */
export interface RetailerAccount {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    /** The retailer. Still `customerId` — the wire format the app shares. */
    customerId: Types.ObjectId;
    dukandarId?: Types.ObjectId;

    /**
     * Rupees paid in and deliberately NOT applied to anything.
     *
     * The retailer's own choice: he hands over money but keeps his metal
     * position open, waiting for a rate he likes. Allocating it later buys
     * metal at the rate on the day of ALLOCATION, never the day it arrived —
     * that difference is the entire point of leaving it held.
     */
    heldCash: number;

    /**
     * Grams of 99.50 fine held for the retailer and not yet used: credited
     * from completed melt lots, or left as a gold advance (`gold-received`).
     *
     * Metal the wholesaler is holding on the retailer's behalf. Drawn down
     * against bills, or paid out as cash or gold. The name predates gold
     * advances and stays, because it is the wire format the apps read.
     */
    meltCredit: number;

    /**
     * Grams of SILVER held for the retailer and not yet used: a silver
     * advance (`silver-received`). Its own balance, never added to gold's;
     * drawn down onto a sale's silver due gram for gram, or handed back.
     */
    silverHeld: number;

    entries: AccountEntry[];

    createdAt: Date;
    updatedAt: Date;
}

export type AccountEntryType =
    /** Cash received and held, unallocated. */
    | "cash-received"
    /** Held cash drawn down onto an order, buying metal at that day's rate. */
    | "cash-allocated"
    /** Held cash handed back to the retailer. */
    | "cash-refunded"
    /** A melt lot completed and credited its fine weight. */
    | "melt-credited"
    /** Melt credit drawn down onto an order. */
    | "melt-applied"
    /** Melt credit paid out as cash or handed back as fine gold. */
    | "melt-paid-out"
    /**
     * Gold handed over and held rather than set against a bill: an advance
     * for purchases to come, or metal left before the sale it is meant for.
     * Credited at 99.50 by the inbound rule, exactly as a metal payment on an
     * order would be, and drawn down the same way melt credit is.
     */
    | "gold-received"
    /** Silver handed over and held: a silver advance. Gram for gram, as a
     *  silver sale is charged by net weight with no purity. */
    | "silver-received"
    /** Silver held drawn down onto a sale's silver due. */
    | "silver-applied"
    /** Silver held handed back to the retailer. */
    | "silver-returned";

/**
 * The weighings behind one melt lot, kept because every one of them is a figure
 * the retailer can dispute months later.
 *
 * Recording only the answer throws away the working. A retailer who brought in
 * 10 gm and was credited 9.095 wants to see where the other 0.905 went, and
 * "trust me" is not an answer a wholesaler can give twice.
 *
 * Four measured numbers and two derived ones:
 *
 *   potWeight    what actually went into the pot — stones, lac and
 *                attachments already removed
 *   afterMelt    the lagdi, once dirt and impurities have burnt off
 *   afterTesting the lagdi again, after the skin test and rubbing took
 *                a little more off it
 *   purity       what the test said, as a percentage
 *
 *   fine999      afterTesting x purity — the pure content
 *   (the credit) fine999 restated at 99.50, which is the fineness this
 *                product settles everything at
 *
 * The purity is the TESTED one, not the charged one. `chargedPurity` uplifts
 * 91.6 to 92 because that is what a wholesaler charges a retailer on a sale;
 * uplifting a lot the wholesaler is BUYING would credit metal that was never
 * there.
 */
export interface MeltLot {
    potWeight: number;
    afterMelt: number;
    afterTesting: number;
    purity: number;
    fine999: number;
}

/**
 * One movement, kept so a balance can always be explained rather than just
 * asserted. A retailer disputing a figure needs the history, not the total.
 */
export interface AccountEntry {
    _id?: Types.ObjectId;
    date: Date;
    type: AccountEntryType;

    /** Rupees moved. Positive adds to what is held, negative draws it down. */
    cashDelta: number;
    /** Grams of 99.50 moved, same sign convention. */
    metalDelta: number;
    /** Grams of silver moved, same sign convention. */
    silverDelta?: number;
    /** `cash-allocated` only: the metal the cash bought. Missing = gold. */
    metal?: "gold" | "silver";

    /** The rate a conversion happened at, when one did. */
    rate?: number;
    /** The order this movement was applied to, for the allocation types. */
    orderId?: Types.ObjectId;

    /** Present on `melt-credited` only: how the credited weight was arrived
     *  at, stage by stage. Absent on lots recorded before this existed. */
    melt?: MeltLot;

    /** `gold-received` only: the metal as handed over, before conversion. */
    goldWeight?: number;
    goldPurity?: number;

    notes?: string;
}

export interface ReceiveCashDTO {
    amount: number;
    date?: Date;
    notes?: string;
    /**
     * Internal, never taken from a request: set when the cash is an order's
     * overpayment, so a day book can tell it from money handed over that day.
     * The overpayment was already counted once, as the payment on the order.
     */
    orderId?: string;
}

export interface ReceiveGoldDTO {
    /** Grams as handed over. */
    weight: number;
    /** Its purity as tested or stamped, e.g. 99.9 for a bar, 91.6 for 22K. */
    purity: number;
    date?: Date;
    notes?: string;
}

export interface AllocateCashDTO {
    orderId: string;
    /** Rupees of held cash to apply. */
    amount: number;
    /** Rate on the day of allocation — what the cash buys metal at. On a
     *  silver allocation it is the silver rate per gram. */
    goldRate: number;
    /** Which of the sale's dues the cash buys down. Missing = gold. */
    metal?: "gold" | "silver";
    date?: Date;
    notes?: string;
}

/** Silver handed over and held, or handed back: grams of silver. */
export interface SilverHeldDTO {
    weight: number;
    date?: Date;
    notes?: string;
}

export interface ApplySilverHeldDTO {
    orderId: string;
    /** Grams of silver to draw down onto the sale's silver due. */
    weight: number;
    date?: Date;
    notes?: string;
}

export interface ApplyMeltCreditDTO {
    orderId: string;
    /** Grams of 99.50 fine to draw down. */
    weight: number;
    date?: Date;
    notes?: string;
}
