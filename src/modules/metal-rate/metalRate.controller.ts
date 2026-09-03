import { Request, Response } from "express";
import asyncHandler from "../../common/middlewares/asyncHandler.middleware";
import { MetalRateService } from "./metalRate.service";
import type { ApiResponse } from "../../common/types/api";

export const MetalRateController = {
  // Public endpoint — no auth required (rates come from external live API)
  getMetalRates: asyncHandler(
    async (_req: Request, res: Response<ApiResponse<unknown>>) => {
      const rates = await MetalRateService.getRates();

      res.status(200).json({
        success: true,
        data: rates,
      });
    }
  ),

  // Kept for compatibility — just re-fetches live rates
  updateMetalRates: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const updated = await MetalRateService.updateRates(req.auth!.sub, req.body);
      res.status(200).json({ success: true, data: updated, message: "Metal rates updated successfully" });
    }
  ),
};
