import type { Request, Response } from "express";
import asyncHandler from "../../common/middlewares/asyncHandler.middleware";
import { CatalogProductService } from "./catalogProduct.service";
import { AppError } from "../../common/errors/AppError";
import type { ApiResponse } from "../../common/types/api";

export const CatalogProductController = {
    getAll: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
        const dukandarId = req.auth!.sub;
        const products = await CatalogProductService.getAll(dukandarId);
        res.status(200).json({ success: true, data: products });
    }),

    create: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
        const dukandarId = req.auth!.sub;
        try {
            const product = await CatalogProductService.create(dukandarId, req.body);
            res.status(201).json({ success: true, data: product, message: "Product added to catalog" });
        } catch (error: any) {
            if (error.code === 11000) {
                throw new AppError("A product with that name already exists in your catalog", {
                    statusCode: 409,
                    code: "CONFLICT",
                });
            }
            throw error;
        }
    }),

    update: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
        const dukandarId = req.auth!.sub;
        const { id } = req.params;
        const updated = await CatalogProductService.update(id, dukandarId, req.body);
        if (!updated) {
            throw new AppError("Product not found", { statusCode: 404, code: "NOT_FOUND" });
        }
        res.status(200).json({ success: true, data: updated, message: "Product updated" });
    }),

    delete: asyncHandler(async (req: Request, res: Response<ApiResponse<unknown>>) => {
        const dukandarId = req.auth!.sub;
        const { id } = req.params;
        const deleted = await CatalogProductService.delete(id, dukandarId);
        if (!deleted) {
            throw new AppError("Product not found", { statusCode: 404, code: "NOT_FOUND" });
        }
        res.status(200).json({ success: true, data: null, message: "Product deleted" });
    }),
};
