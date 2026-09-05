import { z } from "zod";
import { INPUT_LIMITS } from "../../common/constants/inputLimits";

const idProofType = z.enum(["aadhaar", "pan", "voter", "driving_licence", "passport", "other"]);
const idProofNumber = z.string().trim().max(INPUT_LIMITS.idProofNumber, `ID proof number must be ${INPUT_LIMITS.idProofNumber} characters or less`).optional().or(z.literal(""));

/**
 * Optional, because a walk-in buying a small item routinely will not give a
 * number and the shopkeeper still has to bill them. Still validated when
 * present — an optional field is not a free-text field.
 */
const phoneValue = z
  .string()
  .trim()
  .min(10, "Phone number must be at least 10 digits")
  .optional()
  .or(z.literal(""));

/**
 * On create, blank normalizes to `undefined` rather than `""`. The unique index
 * is partial on `phone: {$type: "string"}`, so an empty string is a *value* —
 * store it and the second phoneless customer for a shop collides with the first.
 */
const phoneOnCreate = phoneValue.transform((v) => (v ? v : undefined));

/**
 * On update, blank is kept as `""` and means "clear the number I entered by
 * mistake". `undefined` already means "field not sent, leave it alone", so the
 * two cannot be collapsed here — the service turns `""` into a `$unset`.
 */
const phoneOnUpdate = phoneValue;

/** Both optional on the wire. The FORM requires an owner name, but `name` is
 *  derived from these two before the request is sent, so the server's contract
 *  only needs the derived value to be present. */
const personOrShopName = z
  .string()
  .trim()
  .max(INPUT_LIMITS.customerName, `Name must be ${INPUT_LIMITS.customerName} characters or less`)
  .optional()
  .or(z.literal(""));

export const createCustomerSchema = z.object({
  // The derived display name — see customer.model.ts.
  name: z.string().min(2, "Name must be at least 2 characters").max(INPUT_LIMITS.customerName, `Name must be ${INPUT_LIMITS.customerName} characters or less`),
  ownerName: personOrShopName,
  shopName: personOrShopName,
  phone: phoneOnCreate,
  email: z.string().email("Invalid email address").max(INPUT_LIMITS.email, `Email must be ${INPUT_LIMITS.email} characters or less`).optional().or(z.literal("")),
  address: z.string().max(INPUT_LIMITS.customerAddress, `Address must be ${INPUT_LIMITS.customerAddress} characters or less`).optional(),
  idProofType: idProofType.optional(),
  idProofNumber,
});

export const updateCustomerSchema = z.object({
  name: z.string().min(2).max(INPUT_LIMITS.customerName, `Name must be ${INPUT_LIMITS.customerName} characters or less`).optional(),
  ownerName: personOrShopName,
  shopName: personOrShopName,
  phone: phoneOnUpdate,
  email: z.string().email().max(INPUT_LIMITS.email, `Email must be ${INPUT_LIMITS.email} characters or less`).optional().or(z.literal("")),
  address: z.string().max(INPUT_LIMITS.customerAddress, `Address must be ${INPUT_LIMITS.customerAddress} characters or less`).optional(),
  idProofType: idProofType.optional(),
  idProofNumber,
});
