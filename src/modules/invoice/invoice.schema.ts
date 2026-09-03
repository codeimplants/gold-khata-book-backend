import { z } from "zod";
import { GSTIN_REGEX } from "./invoice.gst";
import { INPUT_LIMITS } from "../../common/constants/inputLimits";

export const invoiceItemSchema = z.object({
  name: z.string().min(1, "Item name is required").max(INPUT_LIMITS.itemName, `Item name must be ${INPUT_LIMITS.itemName} characters or less`),
  huid: z.string().max(INPUT_LIMITS.hsnCode, `HUID must be ${INPUT_LIMITS.hsnCode} characters or less`).optional().or(z.literal("")),
  pieces: z.number().min(0),
  itemType: z.string(),
  purity: z.string().or(z.number()),
  grossWeight: z.number().min(0),
  lessWeight: z.number().min(0),
  rate: z.number().min(0),
  makingType: z.string(),
  makingCharge: z.number().optional(),
  chargeDescription: z.string().max(INPUT_LIMITS.itemDescription, `Charge description must be ${INPUT_LIMITS.itemDescription} characters or less`).optional().or(z.literal("")),
  chargeAmount: z.number().optional().default(0),
  discountType: z.string().optional().default("fixed"),
  discount: z.number().optional().default(0),
  hsnCode: z.string().trim().max(INPUT_LIMITS.hsnCode, `HSN code must be ${INPUT_LIMITS.hsnCode} characters or less`).optional(),
});

export const ornamentExchangeItemSchema = z.object({
  type: z.enum(["Gold", "Silver"]),
  itemName: z.string().trim().max(INPUT_LIMITS.itemName, `Item name must be ${INPUT_LIMITS.itemName} characters or less`).optional().or(z.literal("")),
  grossWeight: z.number().min(0).optional(),
  lessWeight: z.number().min(0).optional(),
  netWeight: z.number().min(0).optional(),
  // Free-form, not an enum: old gold often has no standard purity ("916
  // hallmark", "mixed"). Capped because the client lets it be typed freely.
  purity: z
    .string()
    .trim()
    .max(INPUT_LIMITS.purity, `Purity must be ${INPUT_LIMITS.purity} characters or less`)
    .optional()
    .or(z.literal("")),
  ratePerGram: z.number().min(0).optional(),
  amount: z.number().min(0),
});

/**
 * `ornamentExchanges`, accepting the legacy aggregate as well as the row array.
 *
 * Two shapes have existed in the wild: the row array above, and an older
 * `{ gold: { weight, amount }, silver: { weight, amount } }` aggregate that
 * predates per-item exchanges. `InvoiceSchema.ornamentExchanges` is
 * `Schema.Types.Mixed` for exactly that reason — old documents still hold the
 * aggregate — but the zod boundary only ever accepted the array, so a client
 * still sending the old shape was rejected outright with "expected array,
 * received object" and could not complete the request at all.
 *
 * That is not hypothetical: the advance-settlement screen up to and including
 * 1.0.16 sends the aggregate, so every final settlement from a shipped build
 * fails. Fixing the client is necessary but not sufficient — a store release
 * takes days to reach shopkeepers, and the ones already on 1.0.16 cannot settle
 * an order until then. Normalizing here unblocks every installed build the
 * moment the backend deploys.
 *
 * Zero rows are dropped rather than carried through as empty exchanges: the
 * aggregate's "no exchange" is both metals at zero, and a zero row would show
 * up as a meaningless exchange line on the invoice.
 */
export const ornamentExchangesSchema = z.preprocess((value) => {
  if (!value || Array.isArray(value) || typeof value !== "object") return value;

  const legacy = value as Record<string, { weight?: unknown; amount?: unknown }>;
  const toNumber = (n: unknown) => (typeof n === "number" && isFinite(n) ? n : 0);

  return (["Gold", "Silver"] as const)
    .map((type) => {
      const row = legacy[type.toLowerCase()] ?? {};
      return { type, netWeight: toNumber(row.weight), amount: toNumber(row.amount) };
    })
    .filter((row) => row.netWeight > 0 || row.amount > 0);
}, z.array(ornamentExchangeItemSchema).optional());

export const createInvoiceSchema = z.object({
  customerId: z.string().min(24, "Invalid Customer ID"),
  dukandarId: z.string().optional(),
  orderId: z.string().optional(),
  invoiceDate: z.coerce.date(),
  items: z.array(invoiceItemSchema).min(1, "At least one item is required"),
  isOrnamentExchanges: z.boolean().default(false),
  ornamentExchanges: z.array(ornamentExchangeItemSchema).optional(),
  includeGST: z.boolean().default(true),
  gstAmount: z.number().min(0),
  subTotal: z.number().min(0),
  totalAmount: z.number().min(0),
  // GST split/snapshots are server-computed; clients may only send these two.
  gstRate: z.number().min(0).max(100).optional(),
  customerGstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(GSTIN_REGEX, "Invalid GSTIN")
    .optional()
    .or(z.literal("")),
  // Defaults to "cash" (not strictly required) so invoices from
  // already-installed app builds that predate payment-method capture keep
  // working — only newer clients that actually collect it send a real value.
  paymentMethod: z.enum(["cash", "online"]).default("cash"),
  onlinePaymentType: z
    .enum(["upi", "bank_transfer", "cheque", "card", "other"])
    .optional(),
  // Photos themselves arrive later, over multipart, once the invoice has an id
  // and its items have indices. Only the print preference is set at creation.
  includeItemPhotosOnBill: z.boolean().default(false),
});
