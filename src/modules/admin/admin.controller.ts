import { AdminService } from "./admin.service";
import Admin from "./admin.model";
import { Request, Response } from "express";
import type { ApiResponse } from "../../common/types/api";
import { AppError } from "../../common/errors/AppError";

export const AdminController = {
    async createAdmin(req: Request, res: Response<ApiResponse<unknown>>) {
        try {
            const isPhoneExist = await Admin.findOne({
                phone: req.body.phone
            });

            if (isPhoneExist) {
                throw new AppError("Phone Number Already Exist", {
                    statusCode: 409,
                    code: "CONFLICT",
                });
            }

            const admin = await AdminService.createAdmin(req.body);
            res.status(201).json({
                success: true,
                data: admin,
                message: "Admin created successfully",
            });
        } catch (error: any) {
            throw error;
        }
    },

    async getAllAdmins(_req: Request, res: Response<ApiResponse<unknown>>) {
        try {
            const admins = await AdminService.getAllAdmins();
            res.status(200).json({
                success: true,
                data: admins,
            });
        } catch (error: any) {
            throw error;
        }
    },

    async getAdminById(req: Request, res: Response<ApiResponse<unknown>>) {
        try {
            const { id } = req.params;
            const admin = await AdminService.getAdminById(id);

            if (!admin) {
                throw new AppError("Admin not found", {
                    statusCode: 404,
                    code: "NOT_FOUND",
                });
            }

            res.status(200).json({
                success: true,
                data: admin,
            });
        } catch (error: any) {
            throw error;
        }
    },

    async updateAdmin(req: Request, res: Response<ApiResponse<unknown>>) {
        try {
            const { id } = req.params;
            const updatedAdmin = await AdminService.updateAdmin(id, req.body);

            if (!updatedAdmin) {
                throw new AppError("Admin not found", {
                    statusCode: 404,
                    code: "NOT_FOUND",
                });
            }

            res.status(200).json({
                success: true,
                data: updatedAdmin,
                message: "Admin updated successfully",
            });
        } catch (error: any) {
            throw error;
        }
    },

    async deleteAdmin(req: Request, res: Response<ApiResponse<unknown>>) {
        try {
            const { id } = req.params;
            const deletedAdmin = await AdminService.deleteAdmin(id);

            if (!deletedAdmin) {
                throw new AppError("Admin not found", {
                    statusCode: 404,
                    code: "NOT_FOUND",
                });
            }

            res.status(200).json({
                success: true,
                data: null,
                message: "Admin deleted successfully",
            });
        } catch (error: any) {
            throw error;
        }
    }
};