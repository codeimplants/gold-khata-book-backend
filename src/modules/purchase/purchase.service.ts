import { Types } from "mongoose";
import { PurchaseModel } from "./purchase.model";
import type { CreatePurchaseDTO, UpdatePurchaseDTO } from "./purchase.types";
import { ShopDetail } from "../shopDetail/shopDetails.model";
import { splitGstAmount, DEFAULT_HSN_CODE } from "../invoice/invoice.gst";

function normalizeGstin(gstin?: string): string | undefined {
  const trimmed = gstin?.trim().toUpperCase();
  return trimmed ? trimmed : undefined;
}

export const PurchaseService = {
  async list(userId: string) {
    return PurchaseModel.find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .lean();
  },

  async create(userId: string, payload: CreatePurchaseDTO) {
    const shop = await ShopDetail.findOne({ userId }).lean();
    const shopGstin = normalizeGstin(shop?.gstNo);
    const supplierGstin = normalizeGstin(payload.supplierGstin);

    // Same state-code logic as sales, direction-agnostic: supplier state vs
    // shop state. Unregistered supplier (no GSTIN) => intra split for display.
    const split = splitGstAmount(payload.gstAmount, shopGstin, supplierGstin);

    return PurchaseModel.create({
      userId: new Types.ObjectId(userId),
      supplierName: payload.supplierName,
      supplierGstin,
      purchaseInvoiceNumber: payload.purchaseInvoiceNumber,
      purchaseDate:
        payload.purchaseDate instanceof Date
          ? payload.purchaseDate
          : new Date(payload.purchaseDate),
      taxableValue: payload.taxableValue,
      gstRate: payload.gstRate ?? shop?.gstPercentage ?? 3,
      gstAmount: payload.gstAmount,
      cgstAmount: split.cgstAmount,
      sgstAmount: split.sgstAmount,
      igstAmount: split.igstAmount,
      supplyType: split.supplyType,
      shopGstin,
      hsnCode: payload.hsnCode?.trim() || DEFAULT_HSN_CODE,
      description: payload.description?.trim() || undefined,
      category: payload.category?.trim() || undefined,
      weightGrams: payload.weightGrams,
    });
  },

  async update(userId: string, purchaseId: string, payload: UpdatePurchaseDTO) {
    if (!Types.ObjectId.isValid(purchaseId)) return null;

    const existing = await PurchaseModel.findOne({
      _id: new Types.ObjectId(purchaseId),
      userId: new Types.ObjectId(userId),
    });
    if (!existing) return null;

    const supplierGstin =
      payload.supplierGstin !== undefined
        ? normalizeGstin(payload.supplierGstin)
        : existing.supplierGstin;
    const gstAmount = payload.gstAmount ?? existing.gstAmount;

    // Re-derive split when GST inputs change; preserve shopGstin snapshot.
    const split = splitGstAmount(gstAmount, existing.shopGstin, supplierGstin);

    const updateData: any = {
      ...payload,
      // null (not undefined) so clearing the GSTIN actually unsets it
      supplierGstin: supplierGstin ?? null,
      gstAmount,
      cgstAmount: split.cgstAmount,
      sgstAmount: split.sgstAmount,
      igstAmount: split.igstAmount,
      supplyType: split.supplyType,
    };
    if (payload.purchaseDate !== undefined) {
      updateData.purchaseDate =
        payload.purchaseDate instanceof Date
          ? payload.purchaseDate
          : new Date(payload.purchaseDate);
    }

    return PurchaseModel.findOneAndUpdate(
      { _id: new Types.ObjectId(purchaseId), userId: new Types.ObjectId(userId) },
      updateData,
      { new: true, runValidators: true }
    ).lean();
  },

  // Hard delete in v1 (no trash) — invoice soft-delete pattern is the
  // upgrade path if statutory retention becomes a requirement.
  async remove(userId: string, purchaseId: string) {
    if (!Types.ObjectId.isValid(purchaseId)) return null;
    return PurchaseModel.findOneAndDelete({
      _id: new Types.ObjectId(purchaseId),
      userId: new Types.ObjectId(userId),
    }).lean();
  },
};
