import { z } from "zod";
import { GSTIN_REGEX } from "../invoice/invoice.gst";
import { INPUT_LIMITS } from "../../common/constants/inputLimits";

export const createPurchaseSchema = z.object({
  supplierName: z.string().trim().min(1, "Supplier name is required").max(INPUT_LIMITS.supplierName, `Supplier name must be ${INPUT_LIMITS.supplierName} characters or less`),
  supplierGstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(GSTIN_REGEX, "Invalid GSTIN")
    .optional()
    .or(z.literal("")),
  purchaseInvoiceNumber: z
    .string()
    .trim()
    .min(1, "Purchase invoice number is required")
    .max(INPUT_LIMITS.invoiceNumber, `Purchase invoice number must be ${INPUT_LIMITS.invoiceNumber} characters or less`),
  purchaseDate: z.coerce.date(),
  taxableValue: z.number().min(0),
  gstRate: z.number().min(0).max(100).optional(),
  gstAmount: z.number().min(0),
  hsnCode: z.string().trim().max(INPUT_LIMITS.hsnCode, `HSN code must be ${INPUT_LIMITS.hsnCode} characters or less`).optional(),
  description: z.string().trim().max(INPUT_LIMITS.itemDescription, `Description must be ${INPUT_LIMITS.itemDescription} characters or less`).optional().or(z.literal("")),
  category: z.string().trim().optional().or(z.literal("")),
  weightGrams: z.number().min(0).optional(),
});

export const updatePurchaseSchema = createPurchaseSchema.partial();
