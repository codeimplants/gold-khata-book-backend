import { z } from "zod";
import { INPUT_LIMITS } from "../../common/constants/inputLimits";

export const createOrderItemSchema = z.object({
    metal: z.enum(["gold", "silver"]).optional().default("gold"),
    itemName: z.string().min(1, "Item name is required").max(INPUT_LIMITS.itemName, `Item name must be ${INPUT_LIMITS.itemName} characters or less`),
    weight: z.number().min(0, "Weight must be positive"),
    // Percent, not a karat string. 91.6, not "22K" — the uplift needs a number
    // to floor, and a karat label cannot express the odd purities that turn up.
    // Optional because a silver line has none; the refinement below still
    // requires it on gold.
    purity: z.number().min(0).max(100, "Purity cannot exceed 100").optional().default(0),
    wastage: z.number().min(0).optional().default(0),
    rate: z.number().min(0).optional(),
    // Silver only. `weight` carries the net weight on a silver line.
    quantity: z.number().min(0).optional(),
    grossWeight: z.number().min(0).optional(),
    packetWeight: z.number().min(0).optional(),
}).refine(
    (i) => i.metal === "silver" || (i.purity ?? 0) > 0,
    { message: "Purity is required", path: ["purity"] },
);

export const createOrderSchema = z.object({
    customerId: z.string().min(24, "Invalid Customer ID"),
    dukandarId: z.string().optional(),
    orderDate: z.coerce.date().optional(),
    items: z.array(createOrderItemSchema).min(1, "At least one item is required"),
    paymentMode: z.enum(["advance", "complete"]),
    bookingRate: z.number().optional(),
    includeGST: z.boolean().default(true),
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
    // A retailer settles in cash, in gold, or in both, so neither leg is
    // required on its own — but a payment of nothing is not a payment, which
    // the refinement below enforces.
    amount: z.number().min(0).default(0),
    goldRate: z.number().min(0).default(0),
    goldWeight: z.number().min(0).optional(),
    goldPurity: z.number().min(0).max(100).optional(),
    silverWeight: z.number().min(0).optional(),
    settles: z.enum(["metal", "cash", "silver"]).optional(),
    date: z.coerce.date().optional(),
    paymentType: z.enum(["advance", "final"]).optional(),
    notes: z.string().max(INPUT_LIMITS.notes, `Notes must be ${INPUT_LIMITS.notes} characters or less`).optional(),
    dukandarId: z.string().optional(),
}).refine(
    (p) => (p.amount ?? 0) > 0 || (p.goldWeight ?? 0) > 0 || (p.silverWeight ?? 0) > 0,
    { message: "Enter a cash amount, a gold or silver weight, or both" },
).refine(
    // Cash aimed at metal has to say what rate it bought at, or there is no way
    // to turn it into grams. Cash clearing the charges account needs no rate.
    (p) => !((p.amount ?? 0) > 0 && p.settles !== "cash" && (p.goldRate ?? 0) <= 0),
    { message: "A rate is required for a cash payment against metal" },
);

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
        subTotal: z.number(),
        gstAmount: z.number(),
        totalAmount: z.number(),
    }),
});
