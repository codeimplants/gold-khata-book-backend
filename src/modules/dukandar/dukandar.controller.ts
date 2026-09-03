import type { Request, Response } from "express";
import { DukandarService } from "./dukandar.service";
import type { ApiResponse } from "../../common/types/api";
import { AppError } from "../../common/errors/AppError";
import { createDukandarSchema, updateDukandarSchema, recordAppOpenSchema } from "./dukandar.schema";
import asyncHandler from "../../common/middlewares/asyncHandler.middleware";
import type { CreateDukandarDTO, UpdateDukandarDTO } from "./dukandar.types";
import { locate } from "../../common/utils/geoip";

export const DukandarController = {
    createDukandar: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const validated = createDukandarSchema.parse(req.body);
            const dukandar = await DukandarService.createDukandar(validated as any as CreateDukandarDTO);
            res.status(201).json({
                success: true,
                data: dukandar,
                message: "Dukandar created successfully",
            });
        }
    ),

    getAllDukandars: asyncHandler(
        async (_req: Request, res: Response<ApiResponse<unknown>>) => {
            const dukandars = await DukandarService.getAllDukandars();
            res.status(200).json({
                success: true,
                data: dukandars,
            });
        }
    ),

    getDukandarById: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { id } = req.params;
            const dukandar = await DukandarService.getDukandarById(id);

            if (!dukandar) {
                throw new AppError("Dukandar not found", {
                    statusCode: 404,
                    code: "NOT_FOUND",
                });
            }

            res.status(200).json({
                success: true,
                data: dukandar,
            });
        }
    ),

    updateDukandar: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { id } = req.params;
            const validated = updateDukandarSchema.parse(req.body);
            const updated = await DukandarService.updateDukandar(id, validated as any as UpdateDukandarDTO);

            if (!updated) {
                throw new AppError("Dukandar not found", {
                    statusCode: 404,
                    code: "NOT_FOUND",
                });
            }

            res.status(200).json({
                success: true,
                data: updated,
                message: "Dukandar updated successfully",
            });
        }
    ),

    deleteDukandar: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { id } = req.params;
            const deleted = await DukandarService.deleteDukandar(id);

            if (!deleted) {
                throw new AppError("Dukandar not found", {
                    statusCode: 404,
                    code: "NOT_FOUND",
                });
            }

            res.status(200).json({
                success: true,
                data: null,
                message: "Dukandar deleted successfully",
            });
        }
    ),

    /**
     * Self-service account deletion for the authenticated dukandar.
     *
     * Required by App Store Guideline 5.1.1(v): any app that lets users create an
     * account must let them delete it from inside the app. deleteDukandar above is
     * admin-only, so it cannot serve this purpose.
     *
     * The id comes from the verified JWT (req.auth.sub), never from the request —
     * so a caller can only ever delete their own account.
     *
     * Uses deleteOwnAccount (not deleteDukandar) so the DeletedUserLog is tagged
     * "self" and admin churn reporting can tell voluntary departures apart from
     * admin-side cleanup.
     */
    deleteOwnAccount: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const id = req.auth!.sub;
            const deleted = await DukandarService.deleteOwnAccount(id);

            if (!deleted) {
                throw new AppError("Account not found", {
                    statusCode: 404,
                    code: "NOT_FOUND",
                });
            }

            res.status(200).json({
                success: true,
                data: null,
                message: "Account deleted successfully",
            });
        }
    ),

    getCustomersByDukandarId: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { id } = req.params;
            if (req.auth!.sub !== id) {
                throw new AppError("Unauthorized", {
                    statusCode: 403,
                    code: "FORBIDDEN",
                });
            }
            const customers = await DukandarService.getCustomersByDukandarId(id);
            res.status(200).json({
                success: true,
                data: customers,
            });
        }
    ),

    recordAppOpen: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const validated = recordAppOpenSchema.parse(req.body);
            // Resolved here rather than in the service: the IP lives on the
            // request, and the service layer has no business knowing about HTTP.
            const result = await DukandarService.recordAppOpen(
                req.auth!.sub,
                validated.deviceInfo,
                locate(req),
            );
            if (!result) {
                throw new AppError("Dukandar not found", {
                    statusCode: 404,
                    code: "NOT_FOUND",
                });
            }
            res.status(200).json({
                success: true,
                data: result,
            });
        }
    ),

    getAllDukandarsWithStats: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            // Opt-in so the admin dashboard, which sends no such flag, keeps
            // seeing shops only. Nexus sets ?includeAdmins=true on its users path.
            const includeAdmins = req.query.includeAdmins === "true";
            const stats = await DukandarService.getAllDukandarsWithStats(includeAdmins);
            res.status(200).json({
                success: true,
                data: stats,
            });
        }
    ),

    getAdminAnalytics: asyncHandler(
        async (_req: Request, res: Response<ApiResponse<unknown>>) => {
            const analytics = await DukandarService.getAdminAnalytics();
            res.status(200).json({
                success: true,
                data: analytics,
            });
        }
    ),

    getDukandarStats: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { id } = req.params;
            const stats = await DukandarService.getDukandarStats(id);
            if (!stats) {
                throw new AppError("Dukandar not found", {
                    statusCode: 404,
                    code: "NOT_FOUND",
                });
            }
            res.status(200).json({
                success: true,
                data: stats,
            });
        }
    ),

    bulkDeleteDukandars: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { ids, allowShopsWithData } = req.body as {
                ids?: unknown;
                allowShopsWithData?: unknown;
            };

            if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string")) {
                throw new AppError("ids must be a non-empty array of strings", {
                    statusCode: 400,
                    code: "VALIDATION_ERROR",
                });
            }

            // Must be a literal true. Anything truthy-but-vague ("1", "yes") is
            // treated as not given: overriding the data guard is a decision a
            // caller has to make on purpose, not one a loose payload can drift
            // into.
            const result = await DukandarService.bulkDeleteDukandars(ids as string[], {
                allowShopsWithData: allowShopsWithData === true,
            });
            res.status(200).json({
                success: true,
                data: result,
            });
        }
    ),

    getDeletedUserLogs: asyncHandler(
        async (_req: Request, res: Response<ApiResponse<unknown>>) => {
            const logs = await DukandarService.getDeletedUserLogs();
            res.status(200).json({
                success: true,
                data: logs,
            });
        }
    ),
};

