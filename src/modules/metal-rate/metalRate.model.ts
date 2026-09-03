import { Schema, model } from "mongoose";
import { IMetalRate } from "./metalRate.types";


const MetalRateSchema = new Schema<IMetalRate>(
  {
    dukandarId: {
      type: Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },

    gold: {
      goldPrice24K: { type: Number, required: true },
      goldPrice24K995: { type: Number, required: true },
      goldPrice24K995GW: { type: Number, required: true },
      goldPrice22K: { type: Number, required: true },
      goldPrice18K: { type: Number, required: true },
      goldPrice14K: { type: Number, required: true },
    },

    silver: {
      silverPrice: { type: Number, required: true },
      silverBarPrice: { type: Number, required: true },
    },

  },
  {
    timestamps: true,
  }
);

export const MetalRateModel = model<IMetalRate>(
  "MetalRate",
  MetalRateSchema
);
