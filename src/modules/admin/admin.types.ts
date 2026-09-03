import { Types } from "mongoose";

export interface IAdmin {
  name: string;
  role?: string;
  phone: string;
}

export type CreateAdminDTO = IAdmin;

export type UpdateAdminDTO = Partial<IAdmin>;
