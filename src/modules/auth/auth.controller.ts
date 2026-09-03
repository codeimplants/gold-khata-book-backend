import { generateToken } from "../../common/utils/generateToken";
import { Request, Response } from "express";
import Admin from "../admin/admin.model";
import { Dukandar } from "../dukandar/dukandar.model";
import { CustomerModel } from "../customer/customer.model";
import { ShopDetail } from "../shopDetail/shopDetails.model";
import { locate, mergeLocation } from "../../common/utils/geoip";

const authUser = async (req: Request, res: Response) => {
    const { phone, deviceInfo } = req.body || {};

    const admin = await Admin.findOne({ phone });
    const dukandar = await Dukandar.findOne({ phone: Number(phone) });

    if (admin) {
        const adminToken = generateToken(admin._id, "admin");
        return res.status(201).json({
            message: "Admin Authenticated",
            token: adminToken,
            userType: "admin",
            success: true,
        });
    }

    if (dukandar) {
        // Migration/Update: Ensure ShopDetail has the userId link
        if (dukandar.shopDetails) {
            await ShopDetail.findByIdAndUpdate(dukandar.shopDetails, { userId: dukandar._id });
        }

        // Location is refreshed at login as well as recorded at signup, so a
        // shop that moves, or one that registered before this existed, is
        // eventually reflected. Merged onto what is already stored rather than
        // replacing it: a lookup that fails returns nulls, and writing those
        // would turn one request over a VPN into permanent data loss.
        const location = mergeLocation(dukandar.location, locate(req));

        if (deviceInfo || location) {
            try {
                await Dukandar.findByIdAndUpdate(dukandar._id, {
                    ...(deviceInfo ? { deviceInfo: { ...deviceInfo, updatedAt: new Date() } } : {}),
                    ...(location ? { location } : {}),
                });
            } catch (e) {
                console.error("[Auth] deviceInfo/location update failed:", e);
            }
        }

        const shopDetail = await ShopDetail.findById(dukandar.shopDetails).select("shopName").lean();
        const needsRegistration = !shopDetail?.shopName || !shopDetail.shopName.trim();

        const dukandarToken = generateToken(dukandar._id, "dukandar");
        return res.status(201).json({
            message: "Dukandar Authenticated",
            token: dukandarToken,
            userType: "dukandar",
            needsRegistration,
            success: true,
        });
    }

    // Create new Dukandar account if not found (Skipping customer check as per request)
    try {
        console.log(`[Auth] Creating new Dukandar for phone: ${phone}`);
        // Create ShopDetail first (required by Dukandar). shopName starts blank —
        // the Complete Registration screen collects the real name right after login.
        const newShop = await ShopDetail.create({
            shopName: "",
            phone: Number(phone),
        });

        // Create Dukandar
        const signupLocation = mergeLocation(null, locate(req));

        const newDukandar = await Dukandar.create({
            phone: Number(phone),
            shopDetails: newShop._id,
            ...(deviceInfo ? { deviceInfo: { ...deviceInfo, updatedAt: new Date() } } : {}),
            ...(signupLocation ? { location: signupLocation } : {}),
        });

        // Update ShopDetail with userId (Dukandar ID)
        await ShopDetail.findByIdAndUpdate(newShop._id, { userId: newDukandar._id });

        const dukandarToken = generateToken(newDukandar._id, "dukandar");
        return res.status(201).json({
            message: "Account Created and Authenticated",
            token: dukandarToken,
            userType: "dukandar",
            needsRegistration: true,
            success: true,
        });
    } catch (error: any) {
        console.error("[Auth] Registration Error:", error);
        return res.status(500).json({
            message: "Error during automatic registration",
            error: error.message,
            success: false,
        });
    }
};

export default {
    authUser,
};
