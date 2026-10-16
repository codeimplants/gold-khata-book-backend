import type { Request, Response } from "express";
import { ShopDetailService } from "./shopDetails.service";
import type { ApiResponse } from "../../common/types/api";
import { AppError } from "../../common/errors/AppError";
import { parseMulterPayload } from "../../common/utils/parseMulterPayload";
import { CreateShopDetailDTO, UpdateShopDetailDTO, UpdateShopPreferencesDTO } from "./shopDetails.types";
import { ShopDetail } from "./shopDetails.model";

export const ShopDetailController = {
    async createShopDetails(req: Request, res: Response<ApiResponse<unknown>>) {
        try {
            const userId = req.auth?.sub;
            const role = req.auth?.role;
            const phone = (req as any).user?.phone; // Backup check

            if (role !== 'admin' && role !== 'dukandar') {
                console.error(`[ShopDetailController] 403 Forbidden - Final Check Failed. Role is ${role}`);
                throw new AppError(`Forbidden - Your current role is ${role || 'undefined'}. Please re-login.`, { statusCode: 403, code: "FORBIDDEN" });
            }

            const payload = parseMulterPayload<CreateShopDetailDTO>(req);

            // Add userId to payload if it's a dukandar
            if (role === 'dukandar' && userId) {
                (payload as any).userId = userId;
            }

            // If Dukandar, check if they already have a shop and update instead
            if (role === 'dukandar' && userId) {
                const { Dukandar } = await import("../dukandar/dukandar.model");
                const dukandar = await Dukandar.findById(userId);

                if (dukandar) {
                    // Scenario 1: Already has a shop linked
                    if (dukandar.shopDetails) {
                        const shopId = String(dukandar.shopDetails);
                        const updated = await ShopDetailService.updateShopDetail(shopId, payload as any);
                        if (updated) {
                            return res.status(200).json({
                                success: true,
                                data: updated,
                                message: "Shop updated successfully",
                            });
                        }
                    }

                    // Scenario 2: No shop linked in Dukandar record, but one might exist with their phone
                    const existingShop = await ShopDetail.findOne({ phone: dukandar.phone });
                    if (existingShop) {
                        const updated = await ShopDetailService.updateShopDetail(String(existingShop._id), { ...payload, userId } as any);
                        await Dukandar.findByIdAndUpdate(userId, { shopDetails: existingShop._id });
                        return res.status(200).json({
                            success: true,
                            data: updated,
                            message: "Shop linked and updated successfully",
                        });
                    }
                }
            }

            const shop = await ShopDetailService.createShopDetail(payload);

            // Link to Dukandar if they don't have one
            if (role === 'dukandar' && userId) {
                const { Dukandar } = await import("../dukandar/dukandar.model");
                await Dukandar.findByIdAndUpdate(userId, { shopDetails: shop._id });
            }

            res.status(201).json({
                success: true,
                data: shop,
                message: "Shop created successfully",
            });
        } catch (error: any) {
            if (error.code === 11000) {
                const field = Object.keys(error.keyValue || {})[0] || 'field';
                throw new AppError(`A shop with this ${field} already exists`, {
                    statusCode: 409,
                    code: "CONFLICT",
                    details: error.keyValue,
                });
            }

            throw error;
        }
    },

    async getShopDetails(req: Request, res: Response<ApiResponse<unknown>>) {
        const userId = req.auth?.sub;
        const role = req.auth?.role;

        if (!userId || !role) {
            throw new AppError("Unauthorized", { statusCode: 401, code: "UNAUTHORIZED" });
        }

        const shop = await ShopDetailService.getShopDetailsByUser(userId, role);
        res.status(200).json({
            success: true,
            data: shop,
        });
    },

    async getShopDetailsById(req: Request, res: Response<ApiResponse<unknown>>) {
        const { id } = req.params;
        const shop = await ShopDetailService.getShopById(id);

        if (!shop) {
            throw new AppError("Shop not found", {
                statusCode: 404,
                code: "NOT_FOUND",
            });
        }

        res.status(200).json({
            success: true,
            data: shop,
        });
    },

    async updateShopDetails(req: Request, res: Response<ApiResponse<unknown>>) {
        try {
            const userId = req.auth?.sub;
            const role = req.auth?.role;
            const { id } = req.params;
            let targetId = id;

            // Security: If dukandar, ensure they are updating their own shop
            if (role === 'dukandar') {
                // 1. Try to find the shop directly by userId (new approach)
                let shop = await ShopDetail.findOne({ userId });

                if (shop) {
                    targetId = String(shop._id);
                    console.log(`[Update] Found shop ${targetId} linked via userId ${userId}`);
                } else {
                    // 2. Fallback to legacy Dukandar -> ShopDetails link
                    const { Dukandar } = await import("../dukandar/dukandar.model");
                    const dukandar = await Dukandar.findById(userId);

                    if (!dukandar) {
                        throw new AppError("Dukandar account not found or invalid token", { statusCode: 404 });
                    }

                    if (!dukandar.shopDetails) {
                        // 1. Check if a shop with this dukandar's phone already exists
                        let existingShop = await ShopDetail.findOne({ phone: dukandar.phone });

                        if (!existingShop) {
                            // 2. Create a new "emergency" shop if none exists
                            existingShop = await ShopDetail.create({
                                userId: userId,
                                shopName: "My Shop",
                                phone: dukandar.phone
                            });
                        } else {
                            // Link existing shop by phone to this userId
                            await ShopDetail.findByIdAndUpdate(existingShop._id, { userId: userId });
                        }

                        // 3. Link the shop back to the dukandar
                        await Dukandar.findByIdAndUpdate(userId, { shopDetails: existingShop._id });
                        targetId = String(existingShop._id);
                    } else {
                        // Found legacy link
                        targetId = String(dukandar.shopDetails);
                        // Upgrade to new link
                        await ShopDetail.findByIdAndUpdate(targetId, { userId: userId });
                    }
                }
            } else if (role !== 'admin') {
                console.error(`[ShopDetailController] update 403 Forbidden - Role is ${role}`);
                throw new AppError(`Forbidden - Your current role is ${role || 'undefined'}. Please re-login.`, {
                    statusCode: 403,
                    code: "FORBIDDEN",
                });
            }

            const payload = parseMulterPayload<UpdateShopDetailDTO>(req);
            const updatedShop = await ShopDetailService.updateShopDetail(targetId, payload);
            if (!updatedShop) {
                throw new AppError("Shop not found", {
                    statusCode: 404,
                    code: "NOT_FOUND",
                });
            }

            res.status(200).json({
                success: true,
                data: updatedShop,
                message: "Shop updated successfully",
            });
        } catch (error: any) {
            if (error.code === 11000) {
                const field = Object.keys(error.keyValue || {})[0] || 'field';
                throw new AppError(`A shop with this ${field} already exists`, {
                    statusCode: 409,
                    code: "CONFLICT",
                    details: error.keyValue,
                });
            }
            throw error;
        }
    },

    /**
     * Saves the shop-wide preferences (bill template, app language, declaration
     * language) for the caller's own shop.
     *
     * No shop id in the URL on purpose: it is resolved from the token, so one
     * account cannot write another shop's preferences by guessing an id — a real
     * risk here, because unlike the Edit Shop Details form this endpoint is hit
     * by ordinary settings screens rather than one guarded form.
     */
    async updateShopPreferences(req: Request, res: Response<ApiResponse<unknown>>) {
        const userId = req.auth?.sub;
        const role = req.auth?.role;

        if (!userId || !role) {
            throw new AppError("Unauthorized", { statusCode: 401, code: "UNAUTHORIZED" });
        }

        const { invoiceTemplate, appLanguage, declarationLanguage, oldGoldMelt, defaultMetal } =
            (req.body ?? {}) as UpdateShopPreferencesDTO;

        const shop = await ShopDetailService.updateShopPreferences(userId, role, {
            invoiceTemplate,
            appLanguage,
            declarationLanguage,
            oldGoldMelt,
            defaultMetal,
        });

        if (!shop) {
            throw new AppError("Shop not found", { statusCode: 404, code: "NOT_FOUND" });
        }

        res.status(200).json({
            success: true,
            data: shop,
            message: "Preferences saved",
        });
    },

    async deleteShopDetails(req: Request, res: Response<ApiResponse<unknown>>) {
        const { id } = req.params;
        const deletedShop = await ShopDetailService.deleteShopDetail(id);

        if (!deletedShop) {
            throw new AppError("Shop not found", {
                statusCode: 404,
                code: "NOT_FOUND",
            });
        }

        res.status(200).json({
            success: true,
            data: null,
            message: "Shop deleted successfully",
        });
    },
};

