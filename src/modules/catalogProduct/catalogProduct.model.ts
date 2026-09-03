import { model, Schema, Types } from "mongoose";
import type { ICatalogProduct } from "./catalogProduct.types";
import { INPUT_LIMITS } from "../../common/constants/inputLimits";

const catalogProductSchema = new Schema<ICatalogProduct>(
    {
        dukandarId: {
            type: Schema.Types.ObjectId,
            required: true,
            index: true,
            ref: "Dukandar",
        },
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: [INPUT_LIMITS.itemName, `Item name cannot exceed ${INPUT_LIMITS.itemName} characters`],
        },
        category: {
            type: String,
            required: true,
            trim: true,
            enum: ["Gold", "Silver", "Others"],
            default: "Gold",
        },
        purity: {
            type: String,
            trim: true,
        },
        makingChargeType: {
            type: String,
            trim: true,
            enum: ["Per Gram", "%", "Fix"],
        },
        makingCharges: {
            type: Number,
            min: 0,
            default: 0,
        },
        discountType: {
            type: String,
            trim: true,
            enum: ["Fixed", "%"],
        },
        discount: {
            type: Number,
            min: 0,
            default: 0,
        },
        grossWt: {
            type: Number,
            min: 0,
            default: 0,
        },
        huid: {
            type: String,
            trim: true,
            maxlength: [INPUT_LIMITS.hsnCode, `HUID cannot exceed ${INPUT_LIMITS.hsnCode} characters`],
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

// Compound index: unique name per dukandar
catalogProductSchema.index({ dukandarId: 1, name: 1 }, { unique: true });

export const CatalogProductModel = model<ICatalogProduct>("CatalogProduct", catalogProductSchema);
