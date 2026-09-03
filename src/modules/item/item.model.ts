import mongoose, { Schema } from "mongoose";
import { Item } from "./item.types";
import { INPUT_LIMITS } from "../../common/constants/inputLimits";

const ItemSchema = new Schema<Item>(
  {
    invoiceId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
      ref: "Invoice",
    },

    customerId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
      ref: "Customer",
    },

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

    huid: {
      type: String,
      trim: true,
      maxlength: [INPUT_LIMITS.hsnCode, `HUID cannot exceed ${INPUT_LIMITS.hsnCode} characters`],
    },

    pieces: {
      type: Number,
      required: false,
      min: 0,
    },

    itemType: {
      type: String,
      required: false,
      trim: true,
    },

    purity: {
      type: Schema.Types.Mixed,
      required: false,
    },

    grossWeight: {
      type: Number,
      required: false,
      min: 0,
    },

    lessWeight: {
      type: Number,
      required: false,
      min: 0,
    },

    netWeight: {
      type: Number,
      required: false,
      min: 0,
    },

    rate: {
      type: Number,
      required: false,
      min: 0,
    },

    makingType: {
      type: String,
      required: false,
      trim: true,
    },

    makingCharge: {
      type: Number,
      required: false,
      min: 0,
    },

    chargeDescription: {
      type: String,
      required: false,
      trim: true,
      maxlength: [INPUT_LIMITS.itemDescription, `Charge description cannot exceed ${INPUT_LIMITS.itemDescription} characters`],
    },

    chargeAmount: {
      type: Number,
      required: false,
      min: 0,
    },

    discountType: {
      type: String,
      required: false,
      trim: true,
    },

    discount: {
      type: Number,
      required: false,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

// auto-calculate netWeight
ItemSchema.pre("validate", async function (this: any) {
  const grossWeight = Number(this.grossWeight);
  const lessWeight = Number(this.lessWeight);

  if (Number.isFinite(grossWeight) && Number.isFinite(lessWeight)) {
    this.netWeight = grossWeight - lessWeight;
  }
});

export const ItemModel = mongoose.model<Item>("Item", ItemSchema);
