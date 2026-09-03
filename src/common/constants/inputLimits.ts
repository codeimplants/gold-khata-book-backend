/**
 * Central length caps for free-text fields, enforced server-side.
 *
 * These are the hard guarantee — the mobile app enforces the same numbers as
 * UX (see `gold-khata-book-frontend/src/constants/inputLimits.ts`), but a direct API
 * call, an old client build, or a future integration must not be able to
 * bypass them. Keep both files' numbers in sync.
 *
 * Fields that used to have no limit meant a shopkeeper could paste a whole
 * paragraph (name + full address in one field) into things like "Shop Name",
 * which then overflowed the printed bill header, PDFs, and every admin list.
 */
export const INPUT_LIMITS = {
  shopName: 60,
  ownerName: 50,
  shopDescription: 250,
  addressLine: 120,
  city: 50,
  state: 50,
  website: 100,
  email: 100,
  gstin: 15,

  customerName: 50,
  customerAddress: 200,

  itemName: 60,
  itemDescription: 200,
  hsnCode: 8,
  // Exchange rows accept a free-typed purity for old gold with no standard
  // grade ("916 hallmark", "mixed"), so this is a real cap, not just UX.
  purity: 20,

  invoiceNumber: 20,
  supplierName: 60,
  notes: 300,

  // Old-gold declaration / affidavit
  // Kept in step with the maxlength on PurchaseOldGold.customerSignature and
  // with the express.json body limit in server.ts. A hand-drawn signature is
  // stored as the raw SVG of the ink, so this is a size cap on a document, not
  // a length cap on a name - and it is the one field that can approach the
  // request-body limit on its own.
  customerSignature: 200_000,
  declarationItemDescription: 120,
  idProofNumber: 30,
  idProofOtherLabel: 40,
  witnessName: 50,
  familyMemberName: 60,
  purchaseReceiptDetails: 200,
  noReceiptReason: 250,
  bankName: 60,
  bankAccountName: 60,
  bankAccountNumber: 20,
  ifsc: 11,
  upiId: 60,
  payoutReference: 40,
} as const;

export type InputLimitKey = keyof typeof INPUT_LIMITS;
