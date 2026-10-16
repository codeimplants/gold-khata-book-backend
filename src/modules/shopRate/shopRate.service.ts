import { Types } from "mongoose";
import { ShopRateModel } from "./shopRate.model";

const oid = (v: string) => new Types.ObjectId(v);

export const ShopRateService = {
    /**
     * The shop's rate for one day, or null when they have not set one.
     *
     * Null is a meaningful answer, not a missing one: it is what tells the app
     * to fall back to the live rate and say so. Nothing here invents a value.
     */
    async getForDate(userId: string, date: string, dukandarId?: string) {
        const query: any = { userId: oid(userId), date };
        if (dukandarId) query.dukandarId = oid(dukandarId);
        return ShopRateModel.findOne(query);
    },

    /**
     * Sets, or replaces, the rate for one day.
     *
     * Upserted against the unique (userId, date) index so a shopkeeper who
     * revises the rate at noon overwrites the morning's figure. Keeping both
     * would leave two rates for one day and nothing to choose between them.
     */
    async setForDate(
        userId: string,
        date: string,
        rates: { goldRate?: number; silverRate?: number },
        opts: { notes?: string; dukandarId?: string } = {},
    ) {
        return ShopRateModel.findOneAndUpdate(
            { userId: oid(userId), date },
            {
                $set: {
                    // Only the rate sent: setting today's silver rate must not
                    // wipe the gold rate set this morning, or the reverse.
                    ...(rates.goldRate !== undefined ? { goldRate: rates.goldRate } : {}),
                    ...(rates.silverRate !== undefined ? { silverRate: rates.silverRate } : {}),
                    ...(opts.notes !== undefined ? { notes: opts.notes } : {}),
                    ...(opts.dukandarId ? { dukandarId: oid(opts.dukandarId) } : {}),
                },
                $setOnInsert: { userId: oid(userId), date },
            },
            { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
        );
    },

    /** Clears a day's rate, putting that day back on the live rate. */
    async clearForDate(userId: string, date: string) {
        await ShopRateModel.deleteOne({ userId: oid(userId), date });
        return { date };
    },
};
