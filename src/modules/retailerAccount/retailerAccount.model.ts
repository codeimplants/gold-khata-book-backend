import mongoose, { Schema } from "mongoose";
import type { RetailerAccount } from "./retailerAccount.types";

/** Half a rupee: below this, held cash is spent rather than outstanding. */
export const CASH_SETTLED_EPSILON = 0.5;

/**
 * Grams below which melt credit counts as spent. Mirrors
 * WEIGHT_SETTLED_EPSILON_GM on the order — weights carry full float precision,
 * so a fully-drawn credit lands at ~1e-13 rather than exactly 0, and 0.0005 is
 * where a 3-decimal display stops rounding to "0.000".
 */
export const WEIGHT_SETTLED_EPSILON_GM = 0.0005;

const AccountEntrySchema = new Schema(
    {
        date: { type: Date, required: true, default: Date.now },
        type: {
            type: String,
            required: true,
            enum: [
                "cash-received",
                "cash-allocated",
                "cash-refunded",
                "melt-credited",
                "melt-applied",
                "melt-paid-out",
                "gold-received",
                // Silver held for the retailer: its own balance, in grams of
                // silver, beside gold's and never added to it.
                "silver-received",
                "silver-applied",
                "silver-returned",
            ],
        },
        // Signed: positive adds to what the wholesaler holds, negative draws
        // it down. Not clamped at zero — a movement that took the balance the
        // wrong way is a bug worth seeing, not one worth hiding.
        cashDelta: { type: Number, required: true, default: 0 },
        metalDelta: { type: Number, required: true, default: 0 },
        // Grams of SILVER moved, same sign convention. Separate from
        // metalDelta, which is gold at 99.50: one number for two metals would
        // be wrong for both.
        silverDelta: { type: Number, required: false, default: 0 },
        // Which metal a cash-allocated entry bought. Missing means gold, which
        // is every allocation made before silver existed.
        metal: { type: String, required: false, enum: ["gold", "silver"] },

        rate: { type: Number, required: false, min: 0 },
        orderId: { type: Schema.Types.ObjectId, required: false, ref: "Order" },
        notes: { type: String, required: false, trim: true },

        // `gold-received` only: the metal as it was handed over, before it was
        // restated at 99.50. `metalDelta` is the credit; these are what the
        // retailer will quote back when they dispute it.
        goldWeight: { type: Number, required: false, min: 0 },
        goldPurity: { type: Number, required: false, min: 0, max: 100 },

        // The weighings behind a melt lot — see MeltLot in the types file for
        // what each stage is and why they are all kept. `_id: false` because
        // this is one embedded value, not a collection member.
        melt: {
            type: new Schema(
                {
                    potWeight: { type: Number, required: true, min: 0 },
                    afterMelt: { type: Number, required: true, min: 0 },
                    afterTesting: { type: Number, required: true, min: 0 },
                    purity: { type: Number, required: true, min: 0, max: 100 },
                    fine999: { type: Number, required: true, min: 0 },
                },
                { _id: false },
            ),
            required: false,
        },
    },
    { _id: true },
);

const RetailerAccountSchema = new Schema<RetailerAccount>(
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
            index: true,
            ref: "Customer",
        },
        dukandarId: {
            type: Schema.Types.ObjectId,
            required: false,
            index: true,
            ref: "Dukandar",
        },

        heldCash: { type: Number, required: true, default: 0, min: 0 },
        // All the 99.50 metal held for the retailer: melt lots AND gold left as
        // an advance. Still named for melt because it is the wire format the
        // apps read; the entries say where each gram came from.
        meltCredit: { type: Number, required: true, default: 0, min: 0 },
        // Grams of silver held for the retailer: a silver advance, not yet
        // set against a sale. Recomputed from entries like the two above.
        silverHeld: { type: Number, required: true, default: 0, min: 0 },

        entries: { type: [AccountEntrySchema], required: true, default: [] },
    },
    { timestamps: true },
);

// One account per retailer per wholesaler. The balances are a running total of
// `entries`, so a second document for the same pair would silently split a
// retailer's position in two.
RetailerAccountSchema.index({ userId: 1, customerId: 1 }, { unique: true });

/**
 * Balances are ALWAYS recomputed from entries, never incremented in place.
 *
 * An in-place `+=` drifts the moment any write is retried or partially applied,
 * and a khata that disagrees with its own history is worse than no khata — the
 * retailer's copy is the paper one, and the argument is unwinnable without a
 * movement list that adds up.
 */
RetailerAccountSchema.pre("save", function (this: any) {
    const entries: any[] = this.entries || [];

    const cash = entries.reduce((sum, e) => sum + (Number(e.cashDelta) || 0), 0);
    const metal = entries.reduce((sum, e) => sum + (Number(e.metalDelta) || 0), 0);
    const silver = entries.reduce((sum, e) => sum + (Number(e.silverDelta) || 0), 0);

    this.heldCash = Math.max(0, Number(cash.toFixed(2)));
    // Unrounded, for the same reason order weights are: the rupee figures
    // derived from this are `weight * rate`, and quantising the grams here
    // quantises the money.
    this.meltCredit = Math.max(0, metal);
    this.silverHeld = Math.max(0, silver);
});

export const RetailerAccountModel = mongoose.model<RetailerAccount>(
    "RetailerAccount",
    RetailerAccountSchema,
);
