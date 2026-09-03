import type { Request, Response } from "express";
import asyncHandler from "../../common/middlewares/asyncHandler.middleware";
import { TutorialService } from "./tutorial.service";
import { AppError } from "../../common/errors/AppError";
import type { ApiResponse } from "../../common/types/api";

/** Mongo duplicate-key — a slug that already exists. */
const isDuplicate = (error: any): boolean => error?.code === 11000;

export const TutorialController = {
  getLibrary: asyncHandler(async (_req: Request, res: Response<ApiResponse<unknown>>) => {
    const library = await TutorialService.getLibrary();
    res.status(200).json({ success: true, data: library });
  }),

  getAllForAdmin: asyncHandler(async (_req: Request, res: Response<ApiResponse<unknown>>) => {
    const library = await TutorialService.getAllForAdmin();
    res.status(200).json({ success: true, data: library });
  }),

  create: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    try {
      const tutorial = await TutorialService.create(req.body);
      res.status(201).json({ success: true, data: tutorial, message: "Tutorial created" });
    } catch (error: any) {
      if (isDuplicate(error)) {
        throw new AppError("A tutorial with that slug already exists", {
          statusCode: 409,
          code: "CONFLICT",
        });
      }
      throw error;
    }
  }),

  update: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    const { id } = req.params;
    try {
      const updated = await TutorialService.update(id, req.body);
      if (!updated) {
        throw new AppError("Tutorial not found", { statusCode: 404, code: "NOT_FOUND" });
      }
      res.status(200).json({ success: true, data: updated, message: "Tutorial updated" });
    } catch (error: any) {
      if (isDuplicate(error)) {
        throw new AppError("A tutorial with that slug already exists", {
          statusCode: 409,
          code: "CONFLICT",
        });
      }
      throw error;
    }
  }),

  delete: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    const { id } = req.params;
    const deleted = await TutorialService.delete(id);
    if (!deleted) {
      throw new AppError("Tutorial not found", { statusCode: 404, code: "NOT_FOUND" });
    }
    res.status(200).json({ success: true, data: null, message: "Tutorial deleted" });
  }),

  createCategory: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    try {
      const category = await TutorialService.createCategory(req.body);
      res.status(201).json({ success: true, data: category, message: "Category created" });
    } catch (error: any) {
      if (isDuplicate(error)) {
        throw new AppError("A category with that slug already exists", {
          statusCode: 409,
          code: "CONFLICT",
        });
      }
      throw error;
    }
  }),

  updateCategory: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    const { id } = req.params;
    const updated = await TutorialService.updateCategory(id, req.body);
    if (!updated) {
      throw new AppError("Category not found", { statusCode: 404, code: "NOT_FOUND" });
    }
    res.status(200).json({ success: true, data: updated, message: "Category updated" });
  }),

  deleteCategory: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    const { id } = req.params;
    const { deleted, inUse } = await TutorialService.deleteCategory(id);
    if (inUse > 0) {
      throw new AppError(
        `Cannot delete: ${inUse} tutorial(s) still use this category. Move or delete them first.`,
        { statusCode: 409, code: "CONFLICT" }
      );
    }
    if (!deleted) {
      throw new AppError("Category not found", { statusCode: 404, code: "NOT_FOUND" });
    }
    res.status(200).json({ success: true, data: null, message: "Category deleted" });
  }),
};
