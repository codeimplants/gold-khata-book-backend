import { z } from "zod";
import { INPUT_LIMITS } from "../../common/constants/inputLimits";

const notes = z
    .string()
    .max(INPUT_LIMITS.notes, `Notes must be ${INPUT_LIMITS.notes} characters or less`)
    .optional();

export const receiveCashSchema = z.object({
    amount: z.number().positive("Enter an amount"),
    date: z.coerce.date().optional(),
    notes,
    dukandarId: z.string().optional(),
});

/**
 * Gold left with the wholesaler and held: an advance against purchases to come.
 * The weight and purity as handed over; the server restates it at 99.50.
 */
export const receiveGoldSchema = z.object({
    weight: z.number().positive("Enter a weight"),
    purity: z.number().positive("Enter the purity").max(100, "Purity cannot exceed 100%"),
    date: z.coerce.date().optional(),
    notes,
    dukandarId: z.string().optional(),
});

export const allocateCashSchema = z.object({
    orderId: z.string().min(24, "Invalid Order ID"),
    amount: z.number().positive("Enter an amount"),
    // Required, and deliberately not defaulted to any stored rate: allocation
    // happens at the rate of the day it is allocated, which is the entire
    // reason the retailer left the cash held rather than applying it.
    goldRate: z.number().positive("A gold rate is required"),
    // Which due the cash buys down; `goldRate` is then that metal's rate.
    metal: z.enum(["gold", "silver"]).optional(),
    date: z.coerce.date().optional(),
    notes,
    dukandarId: z.string().optional(),
});

/**
 * Silver left with the wholesaler and held, or handed back: grams of silver,
 * counted gram for gram as a silver sale is.
 */
export const silverHeldSchema = z.object({
    weight: z.number().positive("Enter a weight"),
    date: z.coerce.date().optional(),
    notes,
    dukandarId: z.string().optional(),
});

export const applySilverHeldSchema = z.object({
    orderId: z.string().min(24, "Invalid Order ID"),
    /** Grams of silver to draw down. */
    weight: z.number().positive("Enter a weight"),
    date: z.coerce.date().optional(),
    notes,
    dukandarId: z.string().optional(),
});

export const applyMeltCreditSchema = z.object({
    orderId: z.string().min(24, "Invalid Order ID"),
    /** Grams of 99.50 fine to draw down. */
    weight: z.number().positive("Enter a weight"),
    date: z.coerce.date().optional(),
    notes,
    dukandarId: z.string().optional(),
});

/**
 * The stages behind a lot. Optional as a whole — a shop entering a credit by
 * hand has no weighings to send — but all-or-nothing when present, because a
 * half-filled chain cannot be reconciled and is worse than none.
 */
const meltLot = z.object({
    potWeight: z.number().positive("Enter the weight that went into the pot"),
    afterMelt: z.number().positive("Enter the weight after melting"),
    afterTesting: z.number().positive("Enter the weight after testing"),
    purity: z.number().positive().max(100, "Purity cannot exceed 100%"),
    fine999: z.number().positive(),
}).optional();

export const creditMeltSchema = z.object({
    /** Grams of 99.50 fine. Already converted — the melt chain does that when
     *  the lot is tested, so nothing is converted again on the way in. */
    weight: z.number().positive("Enter a weight"),
    melt: meltLot,
    date: z.coerce.date().optional(),
    notes,
    dukandarId: z.string().optional(),
});

export const payOutMeltSchema = z.object({
    weight: z.number().positive("Enter a weight"),
    /** Present when it leaves as cash, absent when it leaves as metal. */
    rate: z.number().positive().optional(),
    date: z.coerce.date().optional(),
    notes,
    dukandarId: z.string().optional(),
});
