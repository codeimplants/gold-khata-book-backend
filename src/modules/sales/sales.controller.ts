import { Request, Response } from "express";
import asyncHandler from "../../common/middlewares/asyncHandler.middleware";
import { SalesService } from "./sales.service";
import type { ApiResponse } from "../../common/types/api";
import { AppError } from "../../common/errors/AppError";

export const SalesController = {
  getSalesReport: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const { range = "all", startDate, endDate } = req.query;

      const report = await SalesService.getSalesReport(
        req.auth!.sub,
        range as string,
        startDate as string,
        endDate as string
      );

      res.status(200).json({
        success: true,
        data: report,
      });
    }
  ),

  // GST REPORT
  getGstReport: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        throw new AppError("startDate and endDate are required", {
          statusCode: 400,
          code: "VALIDATION_ERROR",
        });
      }

      const report = await SalesService.getGstReport(
        req.auth!.sub,
        startDate as string,
        endDate as string
      );

      res.status(200).json({
        success: true,
        data: report,
      });
    }
  ),

  // DASHBOARD SALES SUMMARY
  getDashboardSalesSummary: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const summary = await SalesService.getDashboardSalesSummary(
        req.auth!.sub
      );

      res.status(200).json({
        success: true,
        data: summary,
      });
    }
  ),
};
