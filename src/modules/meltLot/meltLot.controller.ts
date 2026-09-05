import type { Request, Response } from "express";
import asyncHandler from "../../common/middlewares/asyncHandler.middleware";
import type { ApiResponse } from "../../common/types/api";
import { MeltLotService } from "./meltLot.service";
import {
    createMeltLotSchema,
    recordMeltSchema,
    recordTestSchema,
    listMeltLotsSchema,
} from "./meltLot.schema";

export const MeltLotController = {
    /** Defaults to the open lots — the view the feature exists for. */
    list: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
        const { status, customerId, dukandarId } = listMeltLotsSchema.parse(req.query ?? {});
        const lots = await MeltLotService.list(req.auth!.sub, {
            status: status || "open",
            customerId,
            dukandarId,
        });
        res.status(200).json({ success: true, data: lots });
    }),

    getOne: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
        const lot = await MeltLotService.getById(
            req.auth!.sub,
            req.params.id,
            req.query.dukandarId as string | undefined,
        );
        res.status(200).json({ success: true, data: lot });
    }),

    create: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
        const { customerId, dukandarId, ...payload } = createMeltLotSchema.parse(req.body);
        const lot = await MeltLotService.create(req.auth!.sub, customerId, payload, dukandarId);
        res.status(201).json({ success: true, data: lot, message: "Melt lot opened" });
    }),

    recordMelt: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
        const { dukandarId, ...payload } = recordMeltSchema.parse(req.body);
        const lot = await MeltLotService.recordMelt(
            req.auth!.sub,
            req.params.id,
            payload,
            dukandarId,
        );
        res.status(200).json({ success: true, data: lot, message: "Melted weight recorded" });
    }),

    /** Closes the lot and puts the credit on the retailer's account. */
    recordTest: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
        const { dukandarId, ...payload } = recordTestSchema.parse(req.body);
        const lot = await MeltLotService.recordTest(
            req.auth!.sub,
            req.params.id,
            payload,
            dukandarId,
        );
        res.status(200).json({ success: true, data: lot, message: "Lot tested and credited" });
    }),

    remove: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
        const result = await MeltLotService.remove(
            req.auth!.sub,
            req.params.id,
            req.query.dukandarId as string | undefined,
        );
        res.status(200).json({ success: true, data: result, message: "Melt lot deleted" });
    }),
};
