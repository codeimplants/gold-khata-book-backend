import mongoose, { Schema } from "mongoose";
import type {
  Invoice,
  InvoiceItem,
  InvoiceAdvancePayment,
} from "./invoice.types";
import { getNextSequence } from "../../common/utils/counter.util";

const InvoiceItemSchema = new Schema<InvoiceItem>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    huid: {
      type: String,
      trim: true,
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
    // No schema default — legacy items stay distinguishable; service stamps
    // "7113" on new invoices.
    hsnCode: {
      type: String,
      required: false,
      trim: true,
    },
    // Photos of the item sold. `default: undefined` so items without photos
    // stay absent rather than carrying an empty array, matching ornamentPhotos.
    photos: {
      type: [
        {
          url: { type: String, required: true, trim: true },
          fileId: { type: String, required: true, trim: true },
        },
      ],
      required: false,
      default: undefined,
    },
  },
  // No per-item _id: photos are addressed by the item's index in this array,
  // which is the order the client sent and the order the bill prints in.
  { _id: false }
);

const InvoiceAdvancePaymentSchema = new Schema<InvoiceAdvancePayment>(
  {
    date: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0 },
    goldRate: { type: Number, required: true, min: 0 },
    weightCovered: { type: Number, required: true, min: 0 },
    paymentType: {
      type: String,
      enum: ["advance", "final"],
      default: "advance",
    },
    notes: { type: String, trim: true },
  },
  { _id: false }
);

const InvoiceSchema = new Schema<Invoice>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
      ref: "Dukandar",
    },

    customerId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Customer",
      index: true,
    },

    dukandarId: {
      type: Schema.Types.ObjectId,
      required: false,
      ref: "Dukandar",
      index: true,
    },
    orderId: {
      type: Schema.Types.ObjectId,
      required: false,
      ref: "Order",
      index: true,
    },

    invoiceDate: {
      type: Date,
      required: true,
    },

    invoiceNumber: {
      type: String,
      required: false, // Changed from true to false to allow hook to populate it
    },

    items: {
      type: [InvoiceItemSchema],
      required: true,
      validate: {
        validator: (value: InvoiceItem[]) =>
          Array.isArray(value) && value.length > 0,
        message: "At least one item is required",
      },
    },

    isOrnamentExchanges: {
      type: Boolean,
      required: true,
      default: false,
    },

    // Mixed (not a typed sub-schema) so Mongoose never tries to cast this
    // path on read — invoices created before the per-item exchange
    // extension still store the legacy {gold, silver} aggregate shape, and
    // casting that against an array schema on every hydrate would risk
    // errors/data loss for those older documents. Shape validation for new
    // writes happens at the zod boundary (ornamentExchangeItemSchema).
    ornamentExchanges: {
      type: Schema.Types.Mixed,
      required: false,
    },

    includeGST: {
      type: Boolean,
      required: true,
      default: false,
    },

    subTotal: {
      type: Number,
      required: true,
      min: 0,
    },

    gstAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    // GST breakdown — server-computed; absent on pre-extension invoices.
    gstRate: {
      type: Number,
      required: false,
      min: 0,
    },
    cgstAmount: {
      type: Number,
      required: false,
      min: 0,
    },
    sgstAmount: {
      type: Number,
      required: false,
      min: 0,
    },
    igstAmount: {
      type: Number,
      required: false,
      min: 0,
    },
    shopGstin: {
      type: String,
      required: false,
      trim: true,
      uppercase: true,
    },
    customerGstin: {
      type: String,
      required: false,
      trim: true,
      uppercase: true,
    },

    // Not `required: true` at the DB layer — invoices created via
    // advance-order completion (unifiedCompleteOrderSchema) don't set it.
    // The direct create-invoice route enforces it at the zod boundary.
    paymentMethod: {
      type: String,
      required: false,
      enum: ["cash", "online"],
    },
    onlinePaymentType: {
      type: String,
      required: false,
      enum: ["upi", "bank_transfer", "cheque", "card", "other"],
    },

    supplyType: {
      type: String,
      required: false,
      enum: ["intra", "inter"],
    },
    placeOfSupply: {
      type: String,
      required: false,
      trim: true,
    },

    advancePayments: {
      type: [InvoiceAdvancePaymentSchema],
      required: true,
      default: [],
    },

    // Photos of the old ornaments taken in against this invoice. A full-payment
    // exchange is an Invoice, not an Order, so it needs its own field — the two
    // live in different collections.
    ornamentPhotos: {
      type: [
        {
          url: { type: String, required: true, trim: true },
          fileId: { type: String, required: true, trim: true },
        },
      ],
      required: false,
      default: undefined,
    },

    // Off unless the shopkeeper turns it on, and off for every invoice that
    // predates the field — item photos are a shop-side record first.
    includeItemPhotosOnBill: {
      type: Boolean,
      required: false,
      default: false,
    },

    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Ensure netWeight is always derived from grossWeight and lessWeight
InvoiceSchema.pre("validate", function (this: any) {
  if (Array.isArray(this.items)) {
    this.items = this.items.map((item: any) => {
      const grossWeight = Number(Number(item.grossWeight).toFixed(3));
      const lessWeight = Number(Number(item.lessWeight).toFixed(3));
      const rate = Number(Number(item.rate).toFixed(3));
      const makingCharge = Number(Number(item.makingCharge || 0).toFixed(3));
      const chargeAmount = Number(Number(item.chargeAmount || 0).toFixed(3));
      const discount = Number(Number(item.discount || 0).toFixed(3));

      const netWeight = Number((grossWeight - lessWeight).toFixed(3));

      return {
        ...item,
        grossWeight,
        lessWeight,
        netWeight,
        rate,
        makingCharge,
        chargeAmount,
        discount
      };
    });
  }

  // Set summary totals with 3 decimal precision
  this.subTotal = Number((this.subTotal || 0).toFixed(3));
  this.gstAmount = Number((this.gstAmount || 0).toFixed(3));
  this.totalAmount = Number((this.totalAmount || 0).toFixed(3));

  if (this.cgstAmount != null) this.cgstAmount = Number(this.cgstAmount.toFixed(3));
  if (this.sgstAmount != null) this.sgstAmount = Number(this.sgstAmount.toFixed(3));
  if (this.igstAmount != null) this.igstAmount = Number(this.igstAmount.toFixed(3));

  // When isOrnamentExchanges is false, drop ornamentExchanges
  if (!this.isOrnamentExchanges) {
    this.ornamentExchanges = undefined;
  }
});

// Auto-generate invoiceNumber if not provided
InvoiceSchema.pre("save", async function (this: any) {
  if (!this.invoiceNumber) {
    try {
      console.log(`[InvoiceModel] Hook Triggered. Generating number for userId=${this.userId}`);
      console.trace("[InvoiceModel] Trace for invoice creation:");
      const id = this.userId || this.dukandarId || "global";
      const sequence = await getNextSequence(`invoice_${id}`);
      this.invoiceNumber = `INV-${sequence}`;
      console.log(`[InvoiceModel] Assigned: ${this.invoiceNumber}`);
    } catch (err: any) {
      console.error(`[InvoiceModel] Hook Error: ${err.message}`);
      throw err;
    }
  }
});

// GST report queries filter by invoiceDate (statutory periods), not createdAt
InvoiceSchema.index({ userId: 1, invoiceDate: 1 });

// Ensure an order can only have one final invoice per user
InvoiceSchema.index(
  { userId: 1, orderId: 1 },
  { 
    unique: true, 
    partialFilterExpression: { orderId: { $exists: true } } 
  }
);

export const InvoiceModel = mongoose.model<Invoice>("Invoice", InvoiceSchema);
