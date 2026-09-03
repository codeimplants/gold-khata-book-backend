import { Request, Response } from "express";
import asyncHandler from "../../common/middlewares/asyncHandler.middleware";
import { ItemService } from "./item.service";
import { CreateItemDTO, UpdateItemDTO } from "./item.types";
import { AppError } from "../../common/errors/AppError";
import type { ApiResponse } from "../../common/types/api";

export const ItemController = {
  createItem: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      try {
        const payload = req.body as CreateItemDTO;

        const item = await ItemService.createItem(
          req.auth!.sub,
          payload
        );

        res.status(201).json({
          success: true,
          data: item,
          message: "Item created successfully",
        });
      } catch (error: any) {
        if (error.code === 11000) {
          throw new AppError("Item already exists", {
            statusCode: 409,
            code: "CONFLICT",
          });
        }
        throw error;
      }
    }
  ),

  getAllItems: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const items = await ItemService.getAllItems(req.auth!.sub);

      res.status(200).json({
        success: true,
        data: items,
      });
    }
  ),

  updateItem: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const payload = req.body as UpdateItemDTO;

      const updated = await ItemService.updateItem(
        req.params.id,
        req.auth!.sub,
        payload
      );

      if (!updated) {
        throw new AppError("Item not found", {
          statusCode: 404,
          code: "NOT_FOUND",
        });
      }

      res.status(200).json({
        success: true,
        data: updated,
        message: "Item updated successfully",
      });
    }
  ),

  deleteItem: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const deleted = await ItemService.deleteItem(
        req.params.id,
        req.auth!.sub
      );

      if (!deleted) {
        throw new AppError("Item not found", {
          statusCode: 404,
          code: "NOT_FOUND",
        });
      }

      res.status(200).json({
        success: true,
        data: null,
        message: "Item deleted successfully",
      });
    }
  ),
};
