import { Types } from "mongoose";

export interface Item {
  _id: Types.ObjectId; // itemId
  userId: Types.ObjectId; // logged-in user (admin/dukandar owner)

  // Link back to the originating invoice and customer
  invoiceId: Types.ObjectId;
  customerId: Types.ObjectId;
  dukandarId: Types.ObjectId;

  // Product details aligned with invoice product schema
  name: string;
  huid: string;
  pieces: number;
  itemType: string;
  purity: string | number;
  grossWeight: number;
  lessWeight: number;
  netWeight: number;
  rate: number;
  makingType: string;
  makingCharge?: number;
  chargeDescription: string;
  chargeAmount: number;
  discountType: string;
  discount: number;

  createdAt: Date;
  updatedAt: Date;
}

export interface CreateItemDTO {
  invoiceId: string;
  customerId: string;
  dukandarId: string;

  name: string;
  pieces: number;
  itemType: string;
  purity: string | number;
  grossWeight: number;
  lessWeight: number;
  rate: number;
  makingType: string;
  makingCharge?: number;
  chargeDescription: string;
  chargeAmount: number;
  discountType: string;
  discount: number;
}

export interface UpdateItemDTO {
  name?: string;
  pieces?: number;
  itemType?: string;
  purity?: string | number;
  grossWeight?: number;
  lessWeight?: number;
  rate?: number;
  makingType?: string;
  makingCharge?: number;
  chargeDescription?: string;
  chargeAmount?: number;
  discountType?: string;
  discount?: number;
}

