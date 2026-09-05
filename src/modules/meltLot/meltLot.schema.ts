import { z } from "zod";
import { INPUT_LIMITS } from "../../common/constants/inputLimits";

const notes = z
    .string()
    .trim()
    .max(INPUT_LIMITS.notes, `Notes must be ${INPUT_LIMITS.notes} characters or less`)
    .optional();

/** A weighing. Positive because a lot of nothing is not a lot. */
const weight = (label: string) => z.number().positive(label);

export const createMeltLotSchema = z.object({
    customerId: z.string().min(24, "Invalid retailer"),
    potWeight: weight("Enter the weight that went into the pot"),
    receivedAt: z.coerce.date().optional(),
    notes,
    dukandarId: z.string().optional(),
});

export const recordMeltSchema = z.object({
    afterMelt: weight("Enter the weight after melting"),
    meltedAt: z.coerce.date().optional(),
    notes,
    dukandarId: z.string().optional(),
});

export const recordTestSchema = z.object({
    afterTesting: weight("Enter the weight after testing"),
    purity: z.number().positive("Enter the tested purity").max(100, "Purity cannot exceed 100%"),
    testedAt: z.coerce.date().optional(),
    notes,
    dukandarId: z.string().optional(),
});

export const listMeltLotsSchema = z.object({
    /** "open" is the default view — every lot still waiting on a reading. */
    status: z.enum(["open", "received", "melted", "tested"]).optional(),
    customerId: z.string().optional(),
    dukandarId: z.string().optional(),
});
