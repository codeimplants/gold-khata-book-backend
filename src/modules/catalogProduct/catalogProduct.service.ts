import { CatalogProductModel } from "./catalogProduct.model";
import type { CreateCatalogProductDTO, UpdateCatalogProductDTO } from "./catalogProduct.types";
import { Types } from "mongoose";

export const CatalogProductService = {
    async getAll(dukandarId: string) {
        return CatalogProductModel.find({ dukandarId }).sort({ createdAt: -1 }).lean();
    },

    async create(dukandarId: string, payload: CreateCatalogProductDTO) {
        return CatalogProductModel.create({ ...payload, dukandarId });
    },

    async update(id: string, dukandarId: string, payload: UpdateCatalogProductDTO) {
        if (!Types.ObjectId.isValid(id)) return null;
        return CatalogProductModel.findOneAndUpdate(
            { _id: id, dukandarId },
            payload,
            { new: true, runValidators: true }
        ).lean();
    },

    async delete(id: string, dukandarId: string) {
        if (!Types.ObjectId.isValid(id)) return null;
        return CatalogProductModel.findOneAndDelete({ _id: id, dukandarId }).lean();
    },
};
