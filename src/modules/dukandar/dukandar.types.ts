import type { Types } from "mongoose";
import type { CreateShopDetailDTO, UpdateShopDetailDTO } from "../shopDetail/shopDetails.types";

export interface GstConfig {
    gstGold: number;
    gstSilver: number;
    makingGSTRate: number;
}

export interface DeviceInfo {
    platform?: 'android' | 'ios' | 'web';
    make?: string;
    model?: string;
    osVersion?: string;
    /** App build the device last reported — user-facing version and build number. */
    appVersion?: string;
    buildNumber?: string;
    updatedAt?: Date;
}

/**
 * Coarse location, derived from the request IP rather than the device.
 *
 * There is no location permission behind this and no GPS: it is the city the
 * shop's internet connection appears to be in, which is accurate enough to tell
 * Pune from Surat and never accurate enough to find anyone. `country` is an ISO
 * code; `region` is the state.
 *
 * Every field is optional and independently so — the database resolves country
 * far more often than city, and a partial answer is worth keeping.
 */
export interface UserLocation {
    city?: string | null;
    region?: string | null;
    country?: string | null;
    updatedAt?: Date;
}

export interface IDukandar {
    phone: number;
    shopDetails: Types.ObjectId;
    product?: Types.ObjectId;
    gst: GstConfig;
    createdAt?: Date;
    deviceInfo?: DeviceInfo;
    location?: UserLocation;
}

export interface CreateDukandarDTO {
    phone: number;
    shopDetails: CreateShopDetailDTO;
    product?: string;
    gst?: Partial<GstConfig>;
}

export interface UpdateDukandarDTO {
    phone?: number;
    shopDetails?: UpdateShopDetailDTO;
    product?: string;
    gst?: Partial<GstConfig>;
}

