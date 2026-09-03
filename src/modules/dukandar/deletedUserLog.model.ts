import { model, Schema, Types } from "mongoose";

export interface IDeletedUserLog {
    originalDukandarId: Types.ObjectId;
    phone: number;
    shopName: string;
    registrationDate: Date | null;
    deletedAt: Date;
    /**
     * How the account was removed:
     *   manual — an admin deleted a single account
     *   bulk   — an admin deleted accounts in a batch
     *   self   — the user deleted their own account from inside the app
     *
     * "self" is the churn signal: only these represent a shopkeeper choosing to
     * leave. Admin deletions are housekeeping and should not be counted as churn.
     */
    deletionReason: "manual" | "bulk" | "self";
    totalInvoices: number;
    totalSalesValue: number;
    customersCount: number;
    contactCount: number;
}

const deletedUserLogSchema = new Schema<IDeletedUserLog>(
    {
        originalDukandarId: { type: Schema.Types.ObjectId, required: true, index: true },
        phone: { type: Number, required: true },
        shopName: { type: String, default: "" },
        registrationDate: { type: Date, default: null },
        deletedAt: { type: Date, default: Date.now },
        deletionReason: { type: String, enum: ["manual", "bulk", "self"], required: true },
        totalInvoices: { type: Number, default: 0 },
        totalSalesValue: { type: Number, default: 0 },
        customersCount: { type: Number, default: 0 },
        contactCount: { type: Number, default: 0 },
    },
    { versionKey: false }
);

export const DeletedUserLogModel = model<IDeletedUserLog>("DeletedUserLog", deletedUserLogSchema);
