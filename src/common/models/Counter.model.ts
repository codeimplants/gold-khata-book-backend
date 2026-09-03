import mongoose, { Schema } from "mongoose";

export interface ICounter {
    id: string; // Dynamic ID, e.g., "invoice_userId" or "order_userId"
    seq: number;
}

const CounterSchema = new Schema<ICounter>({
    id: { type: String, required: true, unique: true },
    seq: { type: Number, default: 0 }
});

export const CounterModel = mongoose.model<ICounter>("Counter", CounterSchema);
