import { Types } from "mongoose";

export interface ICatalogProduct {
    _id: Types.ObjectId;
    dukandarId: Types.ObjectId;   // owner of this catalog item
    name: string;
    category: string;             // Gold | Silver | Others
    purity?: string;              // e.g. "22K - 91.6%"
    makingChargeType?: string;    // Per Gram | % | Fix
    makingCharges?: number;
    discountType?: string;        // Fixed | %
    discount?: number;
    grossWt?: number;
    huid?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateCatalogProductDTO {
    name: string;
    category: string;
    purity?: string;
    makingChargeType?: string;
    makingCharges?: number;
    discountType?: string;
    discount?: number;
    grossWt?: number;
    huid?: string;
}

export type UpdateCatalogProductDTO = Partial<CreateCatalogProductDTO>;
