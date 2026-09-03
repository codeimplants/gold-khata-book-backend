import { Types } from "mongoose";

/**
 * A stock purchase recorded for GST/ITC purposes (inward supply).
 * v1 deliberately has no stock-quantity logic — description/category/
 * weightGrams are hooks for layering inventory on later.
 */
export interface Purchase {
  _id: Types.ObjectId;
  userId: Types.ObjectId; // Dukandar (owner)

  supplierName: string;
  supplierGstin?: string; // absent => unregistered supplier (ITC ineligible)
  purchaseInvoiceNumber: string; // wholesaler's bill number (free text)
  purchaseDate: Date;

  taxableValue: number;
  gstRate?: number; // e.g. 3
  gstAmount: number; // total GST paid

  // Server-derived from supplier vs shop GSTIN state codes
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  supplyType: "intra" | "inter";
  shopGstin?: string; // snapshot at creation

  hsnCode?: string; // default "7113"

  // Future stock-layering hooks (no quantity logic in v1)
  description?: string;
  category?: string; // Gold | Silver | Others
  weightGrams?: number;

  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePurchaseDTO {
  supplierName: string;
  supplierGstin?: string;
  purchaseInvoiceNumber: string;
  purchaseDate: string | Date;
  taxableValue: number;
  gstRate?: number;
  gstAmount: number;
  hsnCode?: string;
  description?: string;
  category?: string;
  weightGrams?: number;
}

export type UpdatePurchaseDTO = Partial<CreatePurchaseDTO>;
