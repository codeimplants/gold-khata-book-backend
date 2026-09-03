import { Types } from "mongoose";

export type IdProofType =
  | "aadhaar"
  | "pan"
  | "voter"
  | "driving_licence"
  | "passport"
  | "other";

export interface CustomerPhoto {
  url: string;
  fileId: string;
}

export interface Customer {
  _id: Types.ObjectId;        // customerId
  dukandarId: Types.ObjectId; // req.auth.sub

  /** Per-shop display code, "C-1" / "C-2". Assigned by the pre-save hook.
   *  Absent on customers created before the field existed, until the backfill
   *  migration runs — so every reader must treat it as optional. */
  customerCode?: string;

  name: string;
  /** Optional — see the partial unique index in customer.model.ts. Absent, never `""`. */
  phone?: string;
  email?: string;
  address?: string;

  /** Optional, prefills a declaration's ID proof — never locks it. */
  idProofType?: IdProofType;
  idProofNumber?: string;

  /** Optional profile photo, reused on the old-gold declaration so the document
   *  carries a picture of who sold the gold. */
  profilePhoto?: CustomerPhoto;

  invoices: Types.ObjectId[];

  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCustomerDTO {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  idProofType?: IdProofType;
  idProofNumber?: string;
}

export interface UpdateCustomerDTO {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  idProofType?: IdProofType;
  idProofNumber?: string;
}
