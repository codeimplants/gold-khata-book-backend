import { z } from "zod";
import { ornamentExchangeItemSchema, ornamentExchangesSchema } from "../invoice/invoice.schema";
import { INPUT_LIMITS } from "../../common/constants/inputLimits";

export const createOrderItemSchema = z.object({
    itemName: z.string().min(1, "Item name is required").max(INPUT_LIMITS.itemName, `Item name must be ${INPUT_LIMITS.itemName} characters or less`),
    itemType: z.enum(["Gold", "Silver"]),
    purity: z.string().min(1, "Purity is required"),
    weight: z.number().min(0, "Weight must be positive"),
    grossWeight: z.number().min(0).optional(),
    lessWeight: z.number().min(0).optional(),
    rate: z.number().min(0).optional(),
    makingChargeType: z.enum(["Per Gram", "%", "Fix"]),
    makingChargeValue: z.number().min(0, "Making charge value must be positive"),
    chargeDescription: z.string().max(INPUT_LIMITS.itemDescription, `Charge description must be ${INPUT_LIMITS.itemDescription} characters or less`).optional().or(z.literal("")),
    chargeAmount: z.number().optional().default(0),
    discountType: z.string().optional().default("Fixed"),
    discount: z.number().optional().default(0),
});

export const createOrderSchema = z.object({
    customerId: z.string().min(24, "Invalid Customer ID"),
    dukandarId: z.string().optional(),
    orderDate: z.coerce.date().optional(),
    items: z.array(createOrderItemSchema).min(1, "At least one item is required"),
    paymentMode: z.enum(["advance", "complete"]),
    bookingRate: z.number().optional(),
    includeGST: z.boolean().default(true),
    isOrnamentExchanges: z.boolean().default(false),
    ornamentExchanges: z.array(ornamentExchangeItemSchema).optional(),
    gstRate: z.number().min(0).max(100).optional(),
    // Photos arrive later over multipart, once items have indices; only the
    // print preference is set at creation.
    includeItemPhotosOnBill: z.boolean().default(false),
    initialPayment: z.object({
        amount: z.number().min(0),
        goldRate: z.number().min(0),
        notes: z.string().max(INPUT_LIMITS.notes, `Notes must be ${INPUT_LIMITS.notes} characters or less`).optional(),
    }).optional(),
});

export const addPaymentSchema = z.object({
    amount: z.number().min(1, "Amount must be at least 1"),
    goldRate: z.number().min(1, "Gold rate is required"),
    date: z.coerce.date().optional(),
    paymentType: z.enum(["advance", "final"]).optional(),
    notes: z.string().max(INPUT_LIMITS.notes, `Notes must be ${INPUT_LIMITS.notes} characters or less`).optional(),
    dukandarId: z.string().optional(),
});

export const unifiedCompleteOrderSchema = z.object({
    orderId: z.string().min(24, "Invalid Order ID"),
    dukandarId: z.string().optional(),
    payment: z.object({
        amount: z.number().min(0),
        goldRate: z.number().min(0),
        notes: z.string().max(INPUT_LIMITS.notes, `Notes must be ${INPUT_LIMITS.notes} characters or less`).optional(),
        date: z.coerce.date().optional(),
    }).optional(),
    invoice: z.object({
        invoiceDate: z.coerce.date(),
        items: z.array(z.any()), 
        includeGST: z.boolean().default(true),
        isOrnamentExchanges: z.boolean().default(false),
        // Tolerant of the legacy { gold, silver } aggregate that shipped
        // clients still send — see ornamentExchangesSchema.
        ornamentExchanges: ornamentExchangesSchema,
        subTotal: z.number(),
        gstAmount: z.number(),
        totalAmount: z.number(),
    }),
});
