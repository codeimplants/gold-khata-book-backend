import type { Request, Response } from "express";
import { z } from "zod";
import asyncHandler from "../../common/middlewares/asyncHandler.middleware";
import type { ApiResponse } from "../../common/types/api";
import { ShopRateService } from "./shopRate.service";
import { INPUT_LIMITS } from "../../common/constants/inputLimits";

/** A calendar day, not a timestamp — see the note on the model. */
const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

const getSchema = z.object({
    date: dayString.optional(),
    dukandarId: z.string().optional(),
});

const setSchema = z.object({
    date: dayString.optional(),
    goldRate: z.number().positive("Enter a rate"),
    notes: z.string().trim().max(INPUT_LIMITS.notes).optional(),
    dukandarId: z.string().optional(),
});

/**
 * Today in the SERVER's calendar.
 *
 * A shop and its server are in the same country here, so this is safe; it is
 * split out so the one place that decides "what is today" is obvious if that
 * ever stops being true.
 */
const today = () => new Date().toISOString().slice(0, 10);

export const ShopRateController = {
    get: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
        const { date, dukandarId } = getSchema.parse(req.query ?? {});
        const rate = await ShopRateService.getForDate(
            req.auth!.sub,
            date || today(),
            dukandarId,
        );
        // `null` rather than a 404: "this shop has not set a rate today" is a
        // normal state the app acts on, not an error worth a failure path.
        res.status(200).json({ success: true, data: rate });
    }),

    set: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
        const { date, goldRate, notes, dukandarId } = setSchema.parse(req.body);
        const rate = await ShopRateService.setForDate(
            req.auth!.sub,
            date || today(),
            goldRate,
            { notes, dukandarId },
        );
        res.status(200).json({ success: true, data: rate, message: "Rate saved" });
    }),

    clear: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
        const { date } = getSchema.parse(req.query ?? {});
        const result = await ShopRateService.clearForDate(req.auth!.sub, date || today());
        res.status(200).json({ success: true, data: result, message: "Using the live rate" });
    }),
};
