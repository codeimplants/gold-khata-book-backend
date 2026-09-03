import Admin from "./admin.model";
import { IAdmin, CreateAdminDTO, UpdateAdminDTO } from "./admin.types";
import { HydratedDocument, Types } from "mongoose";

export type AdminDocument = HydratedDocument<IAdmin>;

export const AdminService = {
    async createAdmin(payload: CreateAdminDTO): Promise<AdminDocument> {
        return await Admin.create(payload);
    },

    async getAllAdmins(): Promise<AdminDocument[]> {
        return await Admin.find();
    },

    async getAdminById(id: string): Promise<AdminDocument | null> {
        if (!Types.ObjectId.isValid(id)) return null;
        return await Admin.findById(id);
    },

    async updateAdmin(
        id: string,
        payload: UpdateAdminDTO
    ): Promise<AdminDocument | null> {
        if (!Types.ObjectId.isValid(id)) return null;

        return await Admin.findByIdAndUpdate(id, payload, {
            new: true,
            runValidators: true,
        });
    },

    async deleteAdmin(id: string): Promise<AdminDocument | null> {
        if (!Types.ObjectId.isValid(id)) return null;
        return await Admin.findByIdAndDelete(id);
    },
};
