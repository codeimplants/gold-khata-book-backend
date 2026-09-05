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



export const createInvoiceSchema = z.object({
  customerId: z.string().min(24, "Invalid Customer ID"),
  dukandarId: z.string().optional(),
  orderId: z.string().optional(),
  invoiceDate: z.coerce.date(),
  items: z.array(invoiceItemSchema).min(1, "At least one item is required"),
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
