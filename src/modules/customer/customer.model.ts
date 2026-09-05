import mongoose, { Schema } from "mongoose";
import { Customer } from "./customer.types";
import { INPUT_LIMITS } from "../../common/constants/inputLimits";
import { getNextSequence } from "../../common/utils/counter.util";

const CustomerSchema = new Schema<Customer>(
  {
    dukandarId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    // Per-shop display code — "C-1", "C-2" — so two customers with the same
    // name and no phone number are still tellable apart at the counter.
    //
    // `required: false` because the pre-save hook below fills it, exactly like
    // invoiceNumber and declarationNumber. Customers created before this field
    // existed have none until the backfill runs
    // (`npm run migrate:customer-code -- --apply`), and the app renders nothing
    // rather than a placeholder for those.
    customerCode: {
      type: String,
      required: false,
      trim: true,
    },

    // The retailer's DISPLAY identity, and the only name anything downstream
    // reads — what a bill is made out to, what the lists sort and search on,
    // and what the duplicate check compares.
    //
    // Derived at the two write sites rather than typed directly: it is the shop
    // name when there is one and the owner's name when there is not. The form
    // requires an owner and leaves the shop optional, so `name` always has a
    // value while neither typed field is required to. Kept required here for
    // that reason — a customer with no name at all has nothing to bill.
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: [INPUT_LIMITS.customerName, `Name cannot exceed ${INPUT_LIMITS.customerName} characters`],
    },

    // Who you actually deal with. Required by the FORM — a wholesaler always
    // knows the person, even when the shop has no name worth recording — but
    // optional here, because records created before this field existed have
    // none and must keep loading.
    ownerName: {
      type: String,
      required: false,
      trim: true,
      maxlength: [INPUT_LIMITS.customerName, `Owner name cannot exceed ${INPUT_LIMITS.customerName} characters`],
    },

    // The shop, when it has a name. Optional: plenty of small retailers trade
    // under their own name and there is nothing else to record.
    shopName: {
      type: String,
      required: false,
      trim: true,
      maxlength: [INPUT_LIMITS.customerName, `Shop name cannot exceed ${INPUT_LIMITS.customerName} characters`],
    },

    // Optional. A walk-in buying a Rs.800 silver toe-ring routinely will not
    // give a number, and refusing to bill them was never the right trade.
    // Never store `""` for "none" — see the partial index at the bottom of this
    // file for why an empty string is not the same as an absent one.
    phone: {
      type: String,
      required: false,
      trim: true,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: [INPUT_LIMITS.email, `Email cannot exceed ${INPUT_LIMITS.email} characters`],
    },

    address: {
      type: String,
      trim: true,
      maxlength: [INPUT_LIMITS.customerAddress, `Address cannot exceed ${INPUT_LIMITS.customerAddress} characters`],
    },

    // Optional, captured once so a declaration for a repeat customer does not
    // have to ask for ID proof every time. Deliberately no `default` — Mongoose
    // applies schema defaults on hydrate, and a default here would write onto
    // every existing customer the next time they are saved for any reason.
    // A declaration still lets this be overridden per-transaction (the seller
    // may be a family member, not the customer of record), so this is a
    // prefill, never a lock.
    idProofType: {
      type: String,
      required: false,
      enum: ["aadhaar", "pan", "voter", "driving_licence", "passport", "other"],
    },
    idProofNumber: {
      type: String,
      required: false,
      trim: true,
      maxlength: [INPUT_LIMITS.idProofNumber, `ID proof number cannot exceed ${INPUT_LIMITS.idProofNumber} characters`],
    },

    // Optional profile photo. `_id: false` because this is one embedded value,
    // not a collection member — without it Mongoose mints a subdocument id that
    // means nothing and ships to every client.
    profilePhoto: {
      type: new Schema(
        {
          url: { type: String, required: true },
          fileId: { type: String, required: true },
        },
        { _id: false }
      ),
      required: false,
    },

    invoices: [
      {
        type: Schema.Types.ObjectId,
        ref: "Invoice",
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Per-shop sequence, mirroring the invoiceNumber hook in invoice.model.ts and
// the declarationNumber hook in purchaseOldGold.model.ts.
//
// Guarded on the field being absent rather than on `isNew`: setProfilePhoto and
// the photo re-key path both call `customer.save()` on an existing document,
// and a code that silently changed under a customer would be worse than none.
CustomerSchema.pre("save", async function (this: any) {
  if (!this.customerCode) {
    const id = this.dukandarId || "global";
    const sequence = await getNextSequence(`customer_${id}`);
    this.customerCode = `C-${sequence}`;
  }
});

// Partial, not plain-unique and not `sparse`.
//
// Mongo indexes a missing field as `null`, so under a plain unique index the
// second phoneless customer for a shop collides with the first. `sparse: true`
// does not fix a COMPOUND index — it skips a document only when it is missing
// every indexed field, and `dukandarId` is always present. A partial filter is
// the only form that indexes the customers who have a number and ignores the
// ones who do not.
//
// `$type: "string"` rather than `$exists: true` so a stored `""` could not slip
// in and re-create the collision under a different value.
//
// NOTE: changing these options does not change the live index. Mongoose's
// auto-index `createIndex` fails with IndexOptionsConflict when an index of the
// same name exists with different options — it does not replace it, and the
// error surfaces only on the model's `index` event. The old index must be
// dropped explicitly on each environment: `npm run migrate:customer-phone-index`.
CustomerSchema.index(
  { phone: 1, dukandarId: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: "string" } } }
);

export const CustomerModel = mongoose.model<Customer>(
  "Customer",
  CustomerSchema
);

// Keeps a failed index build from taking the process down.
//
// Mongoose auto-indexes on boot. When an index of the same name already exists
// with different options, Mongo answers `createIndex` with IndexOptionsConflict
// (code 85) instead of replacing it — which is exactly what happens if this
// file's partial index is deployed before the migration has dropped the old
// plain-unique one. Mongoose then does `model.emit('error', err)`
// (lib/model.js, `_ensureIndexes`), and a Model is a plain Node EventEmitter:
// emitting 'error' with no listener throws, from inside a floating promise, so
// Node's default unhandled-rejection behaviour exits the process. Under PM2
// that is a crash loop — on prod, shops unable to bill.
//
// Attaching `.catch()` to `init()` sets Mongoose's internal `$caught` flag,
// which suppresses that 'error' emit. `init()` is idempotent (it returns the
// existing `$init`), so calling it here does not build the indexes twice.
//
// The server then stays up with the OLD index still in place. That degrades
// safely: the only thing missing is the ability to store a second customer
// without a phone number, and the duplicate-phone check in the controller does
// not depend on the index at all.
CustomerModel.init().catch((err) => {
  console.error(
    "[CustomerModel] Index build failed — the server is running with the " +
      "PREVIOUS indexes. If this is IndexOptionsConflict (code 85) on " +
      "phone_1_dukandarId_1, run `npm run migrate:customer-phone-index -- --apply` " +
      "for this environment; customers cannot be saved without a phone number " +
      "until you do.",
    err
  );
});
