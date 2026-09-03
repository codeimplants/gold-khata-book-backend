import type { Request, Response } from "express";
import asyncHandler from "../../common/middlewares/asyncHandler.middleware";
import type { ApiResponse } from "../../common/types/api";
import { PurchaseService } from "./purchase.service";
import { createPurchaseSchema, updatePurchaseSchema } from "./purchase.schema";
import type { CreatePurchaseDTO, UpdatePurchaseDTO } from "./purchase.types";
import { AppError } from "../../common/errors/AppError";

export const PurchaseController = {
  list: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    const purchases = await PurchaseService.list(req.auth!.sub);
    res.status(200).json({ success: true, data: purchases });
  }),

  create: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    const validated = createPurchaseSchema.parse(req.body);
    const purchase = await PurchaseService.create(
      req.auth!.sub,
      validated as CreatePurchaseDTO
    );
    res.status(201).json({
      success: true,
      data: purchase,
      message: "Purchase recorded",
    });
  }),

  update: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    const { id } = req.params;
    const validated = updatePurchaseSchema.parse(req.body);
    const updated = await PurchaseService.update(
      req.auth!.sub,
      id,
      validated as UpdatePurchaseDTO
    );
    if (!updated) {
      throw new AppError("Purchase not found", {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }
    res.status(200).json({ success: true, data: updated, message: "Purchase updated" });
  }),

  remove: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    const { id } = req.params;
    const deleted = await PurchaseService.remove(req.auth!.sub, id);
    if (!deleted) {
      throw new AppError("Purchase not found", {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }
    res.status(200).json({ success: true, data: null, message: "Purchase deleted" });
  }),
};
