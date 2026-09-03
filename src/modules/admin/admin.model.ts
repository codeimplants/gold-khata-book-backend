import { model, Schema } from "mongoose";
import { IAdmin } from "./admin.types";

const adminSchema = new Schema<IAdmin>(
  {
    name: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      default: "Admin",
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      match: [/^[0-9]{10}$/, "Invalid phone number"],
    },
  },
  {
    versionKey: false,
  }
);

const Admin = model<IAdmin>("Admin", adminSchema);
export default Admin;
