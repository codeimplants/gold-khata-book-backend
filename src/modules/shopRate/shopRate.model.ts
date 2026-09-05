import mongoose, { Schema } from "mongoose";
import { Types } from "mongoose";

/**
 * The rate this shop is trading at on one day.
 *
 * The live metal rate is a market feed; this is what the shopkeeper has decided
 * to actually deal at, which is routinely not the same number. It is stored
 * per DAY rather than as a single current value so a bill raised last Tuesday
 * can still be explained by the rate that was in force last Tuesday.
 *
 * Deliberately does NOT carry forward. A day with no record uses the live rate,
 * because a rate set on Monday and silently still in force on Friday is how a
 * shop ends up quoting a stale price it never meant to hold.
 */
export interface ShopRate {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    dukandarId?: Types.ObjectId;

    /** YYYY-MM-DD in the shop's own day, not a timestamp — "the rate for the
     *  3rd" is a calendar fact and must not shift with a timezone. */
    date: string;

    /** Rupees per gram of 99.50, the unit everything else here is quoted in. */
    goldRate: number;

    notes?: string;

    createdAt: Date;
    updatedAt: Date;
}

const ShopRateSchema = new Schema<ShopRate>(
    {
        userId: { type: Schema.Types.ObjectId, required: true, index: true, ref: "Dukandar" },
        dukandarId: { type: Schema.Types.ObjectId, required: false, index: true, ref: "Dukandar" },

        date: {
            type: String,
            required: true,
            trim: true,
            match: [/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"],
        },

        goldRate: { type: Number, required: true, min: 0 },
        notes: { type: String, required: false, trim: true },
    },
    { timestamps: true },
);

// One rate per shop per day. The setter upserts against this, so a shopkeeper
// changing their mind at noon replaces the morning's figure rather than adding
// a second one nobody can choose between.
ShopRateSchema.index({ userId: 1, date: 1 }, { unique: true });

export const ShopRateModel = mongoose.model<ShopRate>("ShopRate", ShopRateSchema);
