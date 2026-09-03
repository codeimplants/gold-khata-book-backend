import { model, Schema, Types } from "mongoose";

export interface IAppOpenLog {
    dukandarId: Types.ObjectId;
    date: string; // YYYY-MM-DD (UTC)
    count: number;
}

const appOpenLogSchema = new Schema<IAppOpenLog>(
    {
        dukandarId: { type: Schema.Types.ObjectId, ref: "Dukandar", required: true },
        date: { type: String, required: true },
        count: { type: Number, default: 0 },
    },
    { versionKey: false }
);

appOpenLogSchema.index({ dukandarId: 1, date: 1 }, { unique: true });

export const AppOpenLog = model<IAppOpenLog>("AppOpenLog", appOpenLogSchema);
