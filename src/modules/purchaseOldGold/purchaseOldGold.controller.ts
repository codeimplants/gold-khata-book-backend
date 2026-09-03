import type { Request, Response } from "express";
import asyncHandler from "../../common/middlewares/asyncHandler.middleware";
import type { ApiResponse } from "../../common/types/api";
import { PurchaseOldGoldService } from "./purchaseOldGold.service";
import {
  createPurchaseOldGoldSchema,
  updatePurchaseOldGoldSchema,
  listPurchaseOldGoldQuerySchema,
} from "./purchaseOldGold.schema";
import type {
  CreatePurchaseOldGoldDTO,
  UpdatePurchaseOldGoldDTO,
} from "./purchaseOldGold.types";
import { AppError } from "../../common/errors/AppError";

const notFound = () =>
  new AppError("Declaration not found", { statusCode: 404, code: "NOT_FOUND" });

export const PurchaseOldGoldController = {
  list: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    const filters = listPurchaseOldGoldQuerySchema.parse(req.query);
    const declarations = await PurchaseOldGoldService.list(
      req.auth!.sub,
      filters
    );
    res.status(200).json({ success: true, data: declarations });
  }),

  getById: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    const declaration = await PurchaseOldGoldService.getById(
      req.auth!.sub,
      req.params.id
    );
    if (!declaration) throw notFound();
    res.status(200).json({ success: true, data: declaration });
  }),

  create: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    const validated = createPurchaseOldGoldSchema.parse(req.body);
    const declaration = await PurchaseOldGoldService.create(
      req.auth!.sub,
      validated as CreatePurchaseOldGoldDTO
    );
    res.status(201).json({
      success: true,
      data: declaration,
      message: "Declaration saved",
    });
  }),

  update: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    const validated = updatePurchaseOldGoldSchema.parse(req.body);
    const updated = await PurchaseOldGoldService.update(
      req.auth!.sub,
      req.params.id,
      validated as UpdatePurchaseOldGoldDTO
    );
    if (!updated) throw notFound();
    res
      .status(200)
      .json({ success: true, data: updated, message: "Declaration updated" });
  }),

  remove: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    const deleted = await PurchaseOldGoldService.remove(
      req.auth!.sub,
      req.params.id
    );
    if (!deleted) throw notFound();
    res
      .status(200)
      .json({ success: true, data: null, message: "Declaration deleted" });
  }),

  addPhotos: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    const files = (req.files as any[]) || [];
    if (files.length === 0) {
      throw new AppError("No photos uploaded", {
        statusCode: 400,
        code: "BAD_REQUEST",
      });
    }
    const updated = await PurchaseOldGoldService.addPhotos(
      req.auth!.sub,
      req.params.id,
      files
    );
    if (!updated) throw notFound();
    res
      .status(200)
      .json({ success: true, data: updated, message: "Photos added" });
  }),

  removePhoto: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
    const updated = await PurchaseOldGoldService.removePhoto(
      req.auth!.sub,
      req.params.id,
      req.params.fileId
    );
    if (!updated) throw notFound();
    res
      .status(200)
      .json({ success: true, data: updated, message: "Photo removed" });
  }),

  addItemPhotos: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const files = (req.files as any[]) || [];
      if (files.length === 0) {
        throw new AppError("No photos uploaded", {
          statusCode: 400,
          code: "BAD_REQUEST",
        });
      }
      const updated = await PurchaseOldGoldService.addItemPhotos(
        req.auth!.sub,
        req.params.id,
        req.params.itemId,
        files
      );
      if (!updated) throw notFound();
      res
        .status(200)
        .json({ success: true, data: updated, message: "Photos added" });
    }
  ),

  removeItemPhoto: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const updated = await PurchaseOldGoldService.removeItemPhoto(
        req.auth!.sub,
        req.params.id,
        req.params.itemId,
        req.params.fileId
      );
      if (!updated) throw notFound();
      res
        .status(200)
        .json({ success: true, data: updated, message: "Photo removed" });
    }
  ),

  addIdProofPhotos: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const files = (req.files as any[]) || [];
      if (files.length === 0) {
        throw new AppError("No photos uploaded", {
          statusCode: 400,
          code: "BAD_REQUEST",
        });
      }
      const updated = await PurchaseOldGoldService.addIdProofPhotos(
        req.auth!.sub,
        req.params.id,
        req.params.idProofId,
        files
      );
      if (!updated) throw notFound();
      res
        .status(200)
        .json({ success: true, data: updated, message: "Photos added" });
    }
  ),

  removeIdProofPhoto: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const updated = await PurchaseOldGoldService.removeIdProofPhoto(
        req.auth!.sub,
        req.params.id,
        req.params.idProofId,
        req.params.fileId
      );
      if (!updated) throw notFound();
      res
        .status(200)
        .json({ success: true, data: updated, message: "Photo removed" });
    }
  ),

  addWitnessPhotos: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const files = (req.files as any[]) || [];
      if (files.length === 0) {
        throw new AppError("No photos uploaded", {
          statusCode: 400,
          code: "BAD_REQUEST",
        });
      }
      const updated = await PurchaseOldGoldService.addWitnessPhotos(
        req.auth!.sub,
        req.params.id,
        req.params.witnessId,
        files
      );
      if (!updated) throw notFound();
      res
        .status(200)
        .json({ success: true, data: updated, message: "Photos added" });
    }
  ),

  removeWitnessPhoto: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const updated = await PurchaseOldGoldService.removeWitnessPhoto(
        req.auth!.sub,
        req.params.id,
        req.params.witnessId,
        req.params.fileId
      );
      if (!updated) throw notFound();
      res
        .status(200)
        .json({ success: true, data: updated, message: "Photo removed" });
    }
  ),
};
