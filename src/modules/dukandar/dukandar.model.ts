import { model, Schema, Types } from "mongoose";
import type { IDukandar, GstConfig, DeviceInfo, UserLocation } from "./dukandar.types";

const gstSchema = new Schema<GstConfig>(
    {
        gstGold: {
            type: Number,
            default: 0,
            min: [0, "GST Gold cannot be negative"],
        },
        gstSilver: {
            type: Number,
            default: 0,
            min: [0, "GST Silver cannot be negative"],
        },
        makingGSTRate: {
            type: Number,
            default: 0,
            min: [0, "Making GST rate cannot be negative"],
        },
    },
    { _id: false }
);

const deviceInfoSchema = new Schema<DeviceInfo>(
    {
        platform: { type: String, enum: ["android", "ios", "web"] },
        make: String,
        model: String,
        osVersion: String,
        appVersion: String,
        buildNumber: String,
        updatedAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

// No index: this is read by full scans in the admin/Nexus user list and never
// queried on. Adding one would cost writes on every app open for no read.
const locationSchema = new Schema<UserLocation>(
    {
        city: { type: String, default: null },
        region: { type: String, default: null },
        country: { type: String, default: null },
        updatedAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const dukandarSchema = new Schema<IDukandar>(
    {
        phone: {
            type: Number,
            required: true,
            unique: true,
            validate: {
                validator: (value: number) =>
                    Number.isInteger(value) &&
                    value.toString().length >= 7 &&
                    value.toString().length <= 10,
                message: "Phone number must be 10 digits",
            },
        },
        shopDetails: {
            type: Schema.Types.ObjectId,
            ref: "ShopDetails",
            required: true,
            unique: true,
        },
        gst: {
            type: gstSchema,
            default: () => ({
                gstGold: 0,
                gstSilver: 0,
                makingGSTRate: 0,
            }),
        },
        createdAt: {
            type: Date,
            default: Date.now,
            immutable: true,
        },
        deviceInfo: {
            type: deviceInfoSchema,
            required: false,
        },
        location: {
            type: locationSchema,
            required: false,
        },
    },
    {
        versionKey: false,
    }
);



export const Dukandar = model<IDukandar>("Dukandar", dukandarSchema);

