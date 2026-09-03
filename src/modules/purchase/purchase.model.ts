import mongoose, { Schema } from "mongoose";
import type { Purchase } from "./purchase.types";

const PurchaseSchema = new Schema<Purchase>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
      ref: "Dukandar",
    },

    supplierName: {
      type: String,
      required: true,
      trim: true,
    },

    // Intentionally NOT unique — many purchases share a supplier.
    supplierGstin: {
      type: String,
      required: false,
      trim: true,
      uppercase: true,
    },

    purchaseInvoiceNumber: {
      type: String,
      required: true,
      trim: true,
    },

    purchaseDate: {
      type: Date,
      required: true,
    },

    taxableValue: {
      type: Number,
      required: true,
      min: 0,
    },

    gstRate: {
      type: Number,
      required: false,
      min: 0,
      max: 100,
    },

    gstAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    cgstAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    sgstAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    igstAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    supplyType: {
      type: String,
      required: true,
      enum: ["intra", "inter"],
      default: "intra",
    },

    shopGstin: {
      type: String,
      required: false,
      trim: true,
      uppercase: true,
    },

    hsnCode: {
      type: String,
      required: false,
      trim: true,
    },

    description: {
      type: String,
      required: false,
      trim: true,
    },

    category: {
      type: String,
      required: false,
      trim: true,
    },

    weightGrams: {
      type: Number,
      required: false,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Same 3-decimal rounding convention as the invoice model
PurchaseSchema.pre("validate", function (this: any) {
  this.taxableValue = Number((this.taxableValue || 0).toFixed(3));
  this.gstAmount = Number((this.gstAmount || 0).toFixed(3));
  this.cgstAmount = Number((this.cgstAmount || 0).toFixed(3));
  this.sgstAmount = Number((this.sgstAmount || 0).toFixed(3));
  this.igstAmount = Number((this.igstAmount || 0).toFixed(3));
});

// GST report queries filter by purchaseDate (statutory periods)
PurchaseSchema.index({ userId: 1, purchaseDate: 1 });
PurchaseSchema.index({ userId: 1, createdAt: -1 });

export const PurchaseModel = mongoose.model<Purchase>("Purchase", PurchaseSchema);
