import mongoose, { Schema } from "mongoose";
import type { MeltLot } from "./meltLot.types";
import { getNextSequence } from "../../common/utils/counter.util";

const MeltLotSchema = new Schema<MeltLot>(
    {
        userId: { type: Schema.Types.ObjectId, required: true, index: true, ref: "Dukandar" },
        customerId: { type: Schema.Types.ObjectId, required: true, index: true, ref: "Customer" },
        dukandarId: { type: Schema.Types.ObjectId, required: false, index: true, ref: "Dukandar" },

        lotNumber: { type: String, required: false, trim: true },

        status: {
            type: String,
            required: true,
            default: "received",
            enum: ["received", "melted", "tested"],
            index: true,
        },

        // Stage 1. The only weight required to open a lot — the rest arrive
        // hours later, so they cannot be required here without making it
        // impossible to record ornaments as they are handed over.
        potWeight: { type: Number, required: true, min: 0 },
        receivedAt: { type: Date, required: true, default: Date.now },

        afterMelt: { type: Number, required: false, min: 0 },
        meltedAt: { type: Date, required: false },

        afterTesting: { type: Number, required: false, min: 0 },
        purity: { type: Number, required: false, min: 0, max: 100 },
        testedAt: { type: Date, required: false },

        // Frozen at the moment of crediting. Deliberately stored rather than
        // recomputed on read: the inbound conversion is a trade convention, and
        // changing it later must not silently restate lots that were already
        // settled and agreed with the retailer.
        fine999: { type: Number, required: false, min: 0 },
        creditedWeight: { type: Number, required: false, min: 0 },

        notes: { type: String, required: false, trim: true },
    },
    { timestamps: true },
);

// Per-shop sequence, the same shape as the customer code. Guarded on the field
// being absent rather than on `isNew`, because every stage update saves the
// document again and a lot number that changed under the shopkeeper would be
// worse than none.
MeltLotSchema.pre("save", async function (this: any) {
    if (!this.lotNumber) {
        const id = this.dukandarId || this.userId || "global";
        const sequence = await getNextSequence(`meltlot_${id}`);
        this.lotNumber = `M-${sequence}`;
    }
});

// The list this feature is built around is "what is still open", so it is the
// query worth indexing: a shop's lots, newest first, filtered by status.
MeltLotSchema.index({ userId: 1, status: 1, createdAt: -1 });

export const MeltLotModel = mongoose.model<MeltLot>("MeltLot", MeltLotSchema);
