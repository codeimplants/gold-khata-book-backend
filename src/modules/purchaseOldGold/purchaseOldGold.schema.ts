import { z } from "zod";
import { INPUT_LIMITS } from "../../common/constants/inputLimits";

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or less`)
    .optional()
    .or(z.literal(""));

export const declarationItemSchema = z.object({
  // The client's own opaque key for this ornament, and the handle its photo
  // uploads are addressed by (POST /:id/items/:itemId/photos). Undeclared here
  // until now, which meant Zod stripped it before the service ever saw it:
  // reconcileItems then minted a server-side id the client had no way to know,
  // every per-ornament photo upload 404'd with "Ornament not found", and the
  // declaration saved with the toast "Photos could not be uploaded".
  //
  // The same strip made every edit destructive. reconcileItems re-minted the id
  // of each incoming item, so no stored item matched what was kept and update()
  // collected every ornament photo as orphaned - deleting it from ImageKit for
  // good. Latent only because item photos could never be stored in the first
  // place. Mirrors witnessSchema below, which has always declared its id.
  id: z.string().trim().max(64).optional(),
  description: z
    .string()
    .trim()
    .min(1, "Ornament description is required")
    .max(
      INPUT_LIMITS.declarationItemDescription,
      `Description must be ${INPUT_LIMITS.declarationItemDescription} characters or less`
    ),
  grams: z.number().min(0),
  metalType: z.string().trim().optional().or(z.literal("")),
  purity: z.string().trim().optional().or(z.literal("")),
  ratePerGm: z.number().min(0).optional(),
  amount: z.number().min(0).optional(),
});

export const declarationPayoutSchema = z.object({
  method: z.enum(["cash", "online", "none"]),
  onlineType: z.enum(["upi", "bank_transfer", "cheque", "card", "other"]).optional(),
  reference: optionalText(INPUT_LIMITS.payoutReference, "Reference"),
  paidAt: z.coerce.date().optional(),
  bankName: optionalText(INPUT_LIMITS.bankName, "Bank name"),
  bankAccountName: optionalText(INPUT_LIMITS.bankAccountName, "Account holder name"),
  bankAccountNumber: optionalText(INPUT_LIMITS.bankAccountNumber, "Account number"),
  bankIfsc: optionalText(INPUT_LIMITS.ifsc, "IFSC"),
  upiId: optionalText(INPUT_LIMITS.upiId, "UPI ID"),
});

/**
 * Note there is no `photos` key, and that is the point: zod strips unknown
 * properties, so a client cannot write photo URLs onto a witness by putting
 * them in the request body. They only ever arrive through the upload route.
 */
export const witnessSchema = z.object({
  id: z.string().trim().max(64).optional(),
  name: z
    .string()
    .trim()
    .min(1, "Witness name is required")
    .max(INPUT_LIMITS.witnessName, `Witness name must be ${INPUT_LIMITS.witnessName} characters or less`),
  phone: z.string().trim().optional().or(z.literal("")),
});

/**
 * One ID document. Optional on the wire: an older client sends only the
 * singular fields, and the service derives a single-entry array from those.
 */
export const idProofEntrySchema = z.object({
  // The client's own key, kept so photos of this document can be uploaded
  // against it straight after the save. `photos` is deliberately absent: like
  // witness and ornament photos, they are only ever set by the upload route.
  id: z.string().trim().max(64).optional(),
  type: z.enum(["aadhaar", "pan", "voter", "driving_licence", "passport", "other"]),
  number: z
    .string()
    .trim()
    .min(1, "ID proof number is required")
    .max(INPUT_LIMITS.idProofNumber),
  otherLabel: optionalText(INPUT_LIMITS.idProofOtherLabel, "ID proof name"),
});

export const createPurchaseOldGoldSchema = z
  .object({
    customerId: z.string().trim().min(1, "Customer is required"),
    declarationDate: z.coerce.date(),
    mode: z.enum(["standalone", "exchange"]),
    orderId: z.string().trim().optional().or(z.literal("")),

    // Optional so an older client that never sends it keeps working; those
    // records simply have no recorded language and print in the reader's.
    language: z.enum(["en", "hi", "mr", "gu"]).optional(),
    // Default true - see the model. Absent means an older client, which is
    // exactly the case that should keep printing them.
    includePhotosOnDeclaration: z.boolean().optional(),

    ownerIsSelf: z.boolean(),
    familyMemberName: optionalText(INPUT_LIMITS.familyMemberName, "Family member name"),

    idProofType: z.enum([
      "aadhaar",
      "pan",
      "voter",
      "driving_licence",
      "passport",
      "other",
    ]),
    idProofNumber: z
      .string()
      .trim()
      .min(1, "ID proof number is required")
      .max(
        INPUT_LIMITS.idProofNumber,
        `ID proof number must be ${INPUT_LIMITS.idProofNumber} characters or less`
      ),
    idProofOtherLabel: optionalText(INPUT_LIMITS.idProofOtherLabel, "ID proof name"),
    idProofs: z.array(idProofEntrySchema).max(5).optional(),
    hasPurchaseReceipt: z.boolean().optional(),

    purchaseReceiptDetails: optionalText(
      INPUT_LIMITS.purchaseReceiptDetails,
      "Purchase receipt details"
    ),
    noReceiptReason: optionalText(INPUT_LIMITS.noReceiptReason, "Reason"),

    items: z.array(declarationItemSchema).min(1, "At least one ornament is required"),
    payout: declarationPayoutSchema,
    witnesses: z.array(witnessSchema).max(2, "At most two witnesses").optional(),
    // Deliberately not optionalText(): that trims and rejects an empty string,
    // and an explicit "" is how the Remove control clears a signature - the
    // service reads `!== undefined` to tell "clear it" from "leave it alone".
    // Trimming is wrong here too; this is SVG markup, not free text.
    customerSignature: z.string().max(INPUT_LIMITS.customerSignature).optional(),
  })
  // The clause reads "...belong to myself / my family member (Name: ____)".
  // An unnamed family member leaves the document's central assertion blank,
  // which is exactly the ambiguity the declaration exists to remove.
  .refine((v) => v.ownerIsSelf || Boolean(v.familyMemberName?.trim()), {
    message: "Family member name is required when the goods are not the seller's own",
    path: ["familyMemberName"],
  })
  // "Other" as an ID type is meaningless unless the document is named.
  .refine((v) => v.idProofType !== "other" || Boolean(v.idProofOtherLabel?.trim()), {
    message: "Please name the ID proof document",
    path: ["idProofOtherLabel"],
  })
  .refine((v) => v.mode !== "exchange" || Boolean(v.orderId?.trim()), {
    message: "orderId is required for an exchange declaration",
    path: ["orderId"],
  });

// `.partial()` is unavailable on a ZodEffects (the refines above), so the
// update shape is rebuilt from the raw object and re-refined on the fields
// that are actually present.
export const updatePurchaseOldGoldSchema = z
  .object({
    declarationDate: z.coerce.date().optional(),
    language: z.enum(["en", "hi", "mr", "gu"]).optional(),
    includePhotosOnDeclaration: z.boolean().optional(),
    ownerIsSelf: z.boolean().optional(),
    familyMemberName: optionalText(INPUT_LIMITS.familyMemberName, "Family member name"),
    idProofType: z
      .enum(["aadhaar", "pan", "voter", "driving_licence", "passport", "other"])
      .optional(),
    idProofNumber: z
      .string()
      .trim()
      .min(1, "ID proof number is required")
      .max(INPUT_LIMITS.idProofNumber)
      .optional(),
    idProofOtherLabel: optionalText(INPUT_LIMITS.idProofOtherLabel, "ID proof name"),
    idProofs: z.array(idProofEntrySchema).max(5).optional(),
    hasPurchaseReceipt: z.boolean().optional(),
    purchaseReceiptDetails: optionalText(
      INPUT_LIMITS.purchaseReceiptDetails,
      "Purchase receipt details"
    ),
    noReceiptReason: optionalText(INPUT_LIMITS.noReceiptReason, "Reason"),
    items: z.array(declarationItemSchema).min(1).optional(),
    payout: declarationPayoutSchema.optional(),
    witnesses: z.array(witnessSchema).max(2).optional(),
    // Deliberately not optionalText(): that trims and rejects an empty string,
    // and an explicit "" is how the Remove control clears a signature - the
    // service reads `!== undefined` to tell "clear it" from "leave it alone".
    // Trimming is wrong here too; this is SVG markup, not free text.
    customerSignature: z.string().max(INPUT_LIMITS.customerSignature).optional(),
  })
  .refine(
    (v) => v.ownerIsSelf !== false || Boolean(v.familyMemberName?.trim()),
    {
      message: "Family member name is required when the goods are not the seller's own",
      path: ["familyMemberName"],
    }
  )
  .refine((v) => v.idProofType !== "other" || Boolean(v.idProofOtherLabel?.trim()), {
    message: "Please name the ID proof document",
    path: ["idProofOtherLabel"],
  });

export const listPurchaseOldGoldQuerySchema = z.object({
  customerId: z.string().trim().optional(),
  mode: z.enum(["standalone", "exchange"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
