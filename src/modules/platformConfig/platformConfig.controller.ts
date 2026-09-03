import { Request, Response } from "express";
import type { ApiResponse } from "../../common/types/api";
import { PlatformConfigService } from "./platformConfig.service";

export const PlatformConfigController = {
  async getConfig(_req: Request, res: Response<ApiResponse<unknown>>) {
    try {
      const config = await PlatformConfigService.getConfig();
      res.status(200).json({
        success: true,
        data: config,
      });
    } catch (error: any) {
      throw error;
    }
  },

  async updateConfig(req: Request, res: Response<ApiResponse<unknown>>) {
    try {
      const config = await PlatformConfigService.updateConfig(req.body);
      res.status(200).json({
        success: true,
        data: config,
        message: "Platform config updated successfully",
      });
    } catch (error: any) {
      throw error;
    }
  },
};
