import mongoose, { Schema } from "mongoose";
import type {
  PurchaseOldGold,
  DeclarationItem,
  DeclarationPayout,
  DeclarationPhoto,
  Witness,
  CustomerSnapshot,
  IdProofEntry,
} from "./purchaseOldGold.types";
import { getNextSequence } from "../../common/utils/counter.util";
import { INPUT_LIMITS } from "../../common/constants/inputLimits";

// Declared before the schemas that embed it: these are `const`, so a schema
// referencing it above this point would throw at module load, not compile time.
const DeclarationPhotoSchema = new Schema<DeclarationPhoto>(
  {
    url: { type: String, required: true, trim: true },
    fileId: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const DeclarationItemSchema = new Schema<DeclarationItem>(
  {
    // Kept alongside `_id: false`: the id is the client's own opaque key, which
    // ornament photo uploads are addressed by. A Mongo _id would be generated
    // too late to be useful, since the client needs the key before the save.
    id: { type: String, required: false, trim: true },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: [
        INPUT_LIMITS.declarationItemDescription,
        `Description cannot exceed ${INPUT_LIMITS.declarationItemDescription} characters`,
      ],
    },
    grams: { type: Number, required: true, min: 0 },
    metalType: { type: String, required: false, trim: true },
    purity: { type: String, required: false, trim: true },
    ratePerGm: { type: Number, required: false, min: 0 },
    amount: { type: Number, required: false, min: 0 },
    // No `default: []`, for the same reason as the witness photos below:
    // Mongoose applies defaults on hydrate and would write an empty array onto
    // every pre-existing ornament the next time its declaration was saved.
    photos: { type: [DeclarationPhotoSchema], required: false },
  },
  { _id: false }
);

const DeclarationPayoutSchema = new Schema<DeclarationPayout>(
  {
    // "none" is a real state, not a missing value: on an exchange where the
    // customer owes the shop, no money moves outward at all.
    method: {
      type: String,
      required: true,
      enum: ["cash", "online", "none"],
      default: "cash",
    },
    // Same enum as Invoice.onlinePaymentType so both directions of money
    // movement are described with one vocabulary.
    onlineType: {
      type: String,
      required: false,
      enum: ["upi", "bank_transfer", "cheque", "card", "other"],
    },
    reference: {
      type: String,
      required: false,
      trim: true,
      maxlength: INPUT_LIMITS.payoutReference,
    },
    paidAt: { type: Date, required: false },
    bankName: { type: String, required: false, trim: true, maxlength: INPUT_LIMITS.bankName },
    bankAccountName: {
      type: String,
      required: false,
      trim: true,
      maxlength: INPUT_LIMITS.bankAccountName,
    },
    // Stored in full for the shop's audit trail; the print template masks this
    // to the last 4 digits so a shared PDF never carries the whole number.
    bankAccountNumber: {
      type: String,
      required: false,
      trim: true,
      maxlength: INPUT_LIMITS.bankAccountNumber,
    },
    bankIfsc: {
      type: String,
      required: false,
      trim: true,
      uppercase: true,
      maxlength: INPUT_LIMITS.ifsc,
    },
    upiId: { type: String, required: false, trim: true, maxlength: INPUT_LIMITS.upiId },
  },
  { _id: false }
);

const WitnessSchema = new Schema<Witness>(
  {
    // Deliberately not `required` and with no default: witnesses written before
    // this field existed have none, and a required id would make an unrelated
    // save (adding a photo, say) fail validation on those older records. The
    // service backfills one on every write instead.
    id: { type: String, required: false, trim: true, maxlength: 64 },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: INPUT_LIMITS.witnessName,
    },
    phone: { type: String, required: false, trim: true },
    // Same reasoning as idProofs below — no `default: []`, since Mongoose
    // applies defaults on hydrate and would write an empty array onto every
    // pre-existing witness the next time its declaration was saved.
    photos: { type: [DeclarationPhotoSchema], required: false },
  },
  { _id: false }
);

const IdProofSchema = new Schema<IdProofEntry>(
  {
    // Same contract as the witness id above — not required and with no default,
    // because declarations written before this field existed have none and a
    // required id would fail an unrelated save on those older records. The
    // service backfills one on every write instead.
    id: { type: String, required: false, trim: true, maxlength: 64 },
    type: {
      type: String,
      required: true,
      enum: ["aadhaar", "pan", "voter", "driving_licence", "passport", "other"],
    },
    number: {
      type: String,
      required: true,
      trim: true,
      maxlength: INPUT_LIMITS.idProofNumber,
    },
    otherLabel: {
      type: String,
      required: false,
      trim: true,
      maxlength: INPUT_LIMITS.idProofOtherLabel,
    },
    // No `default: []`, for the same reason as the witness and ornament photos
    // above: Mongoose applies defaults on hydrate and would write an empty
    // array onto every pre-existing ID proof the next time its declaration was
    // saved.
    photos: { type: [DeclarationPhotoSchema], required: false },
  },
  { _id: false }
);

const CustomerSnapshotSchema = new Schema<CustomerSnapshot>(
  {
    name: { type: String, required: true, trim: true, maxlength: INPUT_LIMITS.customerName },
    phone: { type: String, required: true, trim: true },
    address: {
      type: String,
      required: false,
      trim: true,
      maxlength: INPUT_LIMITS.customerAddress,
    },
    photoUrl: { type: String, required: false, trim: true },
  },
  { _id: false }
);

const PurchaseOldGoldSchema = new Schema<PurchaseOldGold>(
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
      index: true,
      ref: "Customer",
    },

    // Populated by the pre-save hook below, so not required at the DB layer.
    declarationNumber: {
      type: String,
      required: false,
    },

    declarationDate: {
      type: Date,
      required: true,
    },

    mode: {
      type: String,
      required: true,
      enum: ["standalone", "exchange"],
      default: "standalone",
    },

    // The language the customer signed this declaration in. Deliberately no
    // default: absent means "written before this existed", and clients fall
    // back to their own language setting for those rather than assuming English.
    language: {
      type: String,
      required: false,
      enum: ["en", "hi", "mr", "gu"],
    },

    // Whether the ornament photographs print on the document. Default true:
    // a declaration is evidence of what came in, and the photograph is the
    // evidence. The bill flag defaults the other way because that document
    // goes to the customer. Older records have no value at all, so readers
    // must treat absent as true.
    includePhotosOnDeclaration: {
      type: Boolean,
      required: false,
      default: true,
    },


    // Set only when mode === "exchange" — the invoice this declaration backs.
    orderId: {
      type: Schema.Types.ObjectId,
      required: false,
      ref: "Order",
      index: true,
    },

    // Frozen copy, deliberately not a join. See CustomerSnapshot in the types.
    customerSnapshot: {
      type: CustomerSnapshotSchema,
      required: true,
    },

    ownerIsSelf: {
      type: Boolean,
      required: true,
      default: true,
    },
    familyMemberName: {
      type: String,
      required: false,
      trim: true,
      maxlength: INPUT_LIMITS.familyMemberName,
    },

    idProofType: {
      type: String,
      required: true,
      enum: ["aadhaar", "pan", "voter", "driving_licence", "passport", "other"],
    },
    idProofNumber: {
      type: String,
      required: true,
      trim: true,
      maxlength: INPUT_LIMITS.idProofNumber,
    },
    idProofOtherLabel: {
      type: String,
      required: false,
      trim: true,
      maxlength: INPUT_LIMITS.idProofOtherLabel,
    },

    // Every ID the seller produced. The three singular fields above are kept
    // in step with the first entry so declarations signed before this existed
    // still render, and so an older app build reading this API is unaffected.
    //
    // No `default: []` on purpose: Mongoose applies defaults on hydrate, so a
    // default here would silently write an empty array onto every existing
    // declaration the next time it was saved.
    idProofs: {
      type: [IdProofSchema],
      required: false,
    },

    // Tri-state by design. `undefined` means the question predates this field,
    // which the print template distinguishes from an explicit "no".
    hasPurchaseReceipt: {
      type: Boolean,
      required: false,
    },
    purchaseReceiptDetails: {
      type: String,
      required: false,
      trim: true,
      maxlength: INPUT_LIMITS.purchaseReceiptDetails,
    },
    noReceiptReason: {
      type: String,
      required: false,
      trim: true,
      maxlength: INPUT_LIMITS.noReceiptReason,
    },

    items: {
      type: [DeclarationItemSchema],
      required: true,
      validate: {
        validator: (value: DeclarationItem[]) =>
          Array.isArray(value) && value.length > 0,
        message: "At least one ornament is required",
      },
    },

    totalGrams: { type: Number, required: true, min: 0, default: 0 },
    totalAmount: { type: Number, required: true, min: 0, default: 0 },

    payout: {
      type: DeclarationPayoutSchema,
      required: true,
    },

    photos: {
      type: [DeclarationPhotoSchema],
      required: true,
      default: [],
    },

    witnesses: {
      type: [WitnessSchema],
      required: true,
      default: [],
    },

    // The seller's signature, captured on the shopkeeper's device and drawn onto
    // the printed declaration.
    //
    // An SVG string rather than an uploaded image: the pad records vector
    // strokes, so this is a few KB of text that rides the ordinary JSON body —
    // no multipart route and no image host, unlike the ornament photos above.
    // maxlength bounds it because it is user-generated and unbounded scribbling
    // would otherwise grow the document without limit.
    //
    // Optional by design. Taking a digital signature is the shopkeeper's choice,
    // and a declaration signed on paper after printing — which is how they all
    // worked before this field existed — remains perfectly valid.
    customerSignature: {
      type: String,
      required: false,
      maxlength: 200_000,
    },
    customerSignedAt: {
      type: Date,
      required: false,
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

// Same 3-decimal rounding convention as the invoice and purchase models.
// Totals are always derived here rather than trusted from the client, so the
// printed document and the stored record can never disagree.
PurchaseOldGoldSchema.pre("validate", function (this: any) {
  if (Array.isArray(this.items)) {
    this.items = this.items.map((item: any) => ({
      ...item,
      grams: Number(Number(item.grams || 0).toFixed(3)),
      ratePerGm:
        item.ratePerGm == null ? undefined : Number(Number(item.ratePerGm).toFixed(3)),
      amount: item.amount == null ? undefined : Number(Number(item.amount).toFixed(3)),
    }));

    this.totalGrams = Number(
      this.items.reduce((sum: number, i: any) => sum + (i.grams || 0), 0).toFixed(3)
    );
    this.totalAmount = Number(
      this.items.reduce((sum: number, i: any) => sum + (i.amount || 0), 0).toFixed(3)
    );
  }

  // An owner who is not the seller must be named — that identification is the
  // entire point of the clause it appears in.
  if (this.ownerIsSelf) {
    this.familyMemberName = undefined;
  }
});

// Per-shop sequence, mirroring the invoiceNumber hook in invoice.model.ts.
// Per-shop sequence for standalone purchases only, mirroring the invoiceNumber
// hook in invoice.model.ts.
//
// An exchange declaration never reaches the counter: the service sets its
// number from the bill it belongs to before saving. The guard below is what
// makes that an invariant rather than a convention — an exchange arriving here
// without a number means the lookup failed, and drawing a POG-n for it would
// both put a wrong number on a legal document and punch a permanent gap in the
// shop's standalone series, which is the defect this split exists to fix.
PurchaseOldGoldSchema.pre("save", async function (this: any) {
  if (this.declarationNumber) return;

  if (this.mode === "exchange") {
    throw new Error(
      "An exchange declaration must take its number from its bill"
    );
  }

  const id = this.userId || "global";
  const sequence = await getNextSequence(`purchaseOldGold_${id}`);
  this.declarationNumber = `POG-${sequence}`;
});

PurchaseOldGoldSchema.index({ userId: 1, createdAt: -1 });
PurchaseOldGoldSchema.index({ customerId: 1, createdAt: -1 });
PurchaseOldGoldSchema.index({ userId: 1, declarationDate: -1 });

// One declaration per bill.
//
// Partial rather than plain, on both counts: standalone declarations have no
// orderId and would otherwise all collide on null, and a soft-deleted
// declaration has to leave the index so a shopkeeper who deletes one can write
// a replacement against the same bill.
PurchaseOldGoldSchema.index(
  { userId: 1, orderId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      orderId: { $exists: true },
      deletedAt: null,
    },
  }
);

// Collection name given explicitly. Mongoose would otherwise lowercase and
// pluralise the model name into "purchaseoldgolds", which is both ugly and not
// what anyone browsing the database expects to find.
export const PurchaseOldGoldModel = mongoose.model<PurchaseOldGold>(
  "PurchaseOldGold",
  PurchaseOldGoldSchema,
  "purchaseOldGold"
);
