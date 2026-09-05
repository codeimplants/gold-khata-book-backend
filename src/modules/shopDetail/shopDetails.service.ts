import { HydratedDocument, Types } from "mongoose";
import { ShopDetail } from "./shopDetails.model";
import type {
    IShopDetail,
    CreateShopDetailDTO,
    UpdateShopDetailDTO,
    UpdateShopPreferencesDTO,
} from "./shopDetails.types";
import { uploadImage, deleteImage } from "../../common/utils/imageKit";

export type ShopDetailDocument = HydratedDocument<IShopDetail>;

// The image fields (shopLogo/shopHeader/signature) are String columns. If a
// non-string object ever reaches Mongoose it is cast to the literal string
// "[object Object]", which then renders as a broken image everywhere. A client
// bug (e.g. appending a { uri, name, type } file descriptor to a browser
// FormData, which has no special handling for it) can also send that literal
// string directly as a form field — no object ever crosses the wire, so this
// must be caught in addition to real objects. Guard the payload so only
// genuine strings (URL / data: / <svg> / "") can be written:
//   - object with a .url string     -> use .url (defensive vs a raw ImageKit result)
//   - the literal string "[object Object]" -> drop (never a valid image reference)
//   - any other non-string value    -> drop the key so it can't overwrite a good value
//   - string                        -> pass through unchanged
const normalizeImageField = (payload: any, key: string): void => {
    if (!(key in payload)) return;
    const value = payload[key];
    if (typeof value === "string") {
        if (value.trim() === "[object Object]") delete payload[key];
        return;
    }
    if (value && typeof value === "object" && typeof value.url === "string") {
        payload[key] = value.url;
        return;
    }
    delete payload[key];
};

const IMAGE_FIELDS = ["shopLogo", "shopHeader", "signature"] as const;

export const ShopDetailService = {

    // ---------------- CREATE ----------------
    async createShopDetail(
        payload: CreateShopDetailDTO
    ): Promise<ShopDetailDocument> {
        const processedPayload: any = { ...payload };

        // Sanitize unique/sparse fields (remove empty strings so sparse index works)
        if (processedPayload.email === "" || processedPayload.email === null) delete processedPayload.email;
        if (processedPayload.gstNo === "" || processedPayload.gstNo === null) delete processedPayload.gstNo;
        if (processedPayload.website === "" || processedPayload.website === null) delete processedPayload.website;

        // Every image a shop owns must land under that shop's phone number —
        // that folder is the shop's whole footprint on ImageKit, and it is what
        // account deletion purges in one call. An upload with no phone would
        // write outside it, to a folder belonging to no shop, which nothing can
        // later attribute or clean up.
        //
        // ImageKit still holds two such files from Jan and Mar 2026, under a
        // literal "shopDetails" folder left by an older upload scheme. No shop
        // record references them and nothing writes there any more; this is the
        // guard that keeps it that way. updateShopDetail has always had one.
        const wantsUpload = Boolean(
            processedPayload.shopLogo?.buffer ||
            processedPayload.shopHeader?.buffer ||
            processedPayload.signature?.buffer
        );
        if (wantsUpload && !processedPayload.phone) {
            throw new Error("Cannot upload shop images: phone number not found for this shop");
        }

        // 🖼 Upload shop logo (binary)
        if (processedPayload.shopLogo?.buffer) {
            const uploadResult = await uploadImage(
                processedPayload.shopLogo,
                processedPayload.phone,
                "shopLogo"
            );
            processedPayload.shopLogo = uploadResult.url;
        }

        // 🖼 Upload shop header (binary)
        if (processedPayload.shopHeader?.buffer) {
            const uploadResult = await uploadImage(
                processedPayload.shopHeader,
                processedPayload.phone,
                "shopHeader"
            );
            processedPayload.shopHeader = uploadResult.url;
        }

        // ✍️ Upload signature (binary)
        if (processedPayload.signature?.buffer) {
            const uploadResult = await uploadImage(
                processedPayload.signature,
                processedPayload.phone,
                "signature"
            );
            processedPayload.signature = uploadResult.url;
        }

        // Final safety net: never let a non-string reach the String image fields.
        IMAGE_FIELDS.forEach((key) => normalizeImageField(processedPayload, key));

        return await ShopDetail.create(processedPayload);
    },

    // ---------------- READ ----------------
    async getShopDetails(): Promise<ShopDetailDocument | null> {
        return await ShopDetail.findOne().sort({ createdAt: -1 });
    },

    async getShopDetailsByUser(userId: string, role: string): Promise<ShopDetailDocument | null> {
        if (!Types.ObjectId.isValid(userId)) return null;

        if (role === 'admin') {
            return await this.getShopDetails();
        }

        if (role === 'dukandar') {
            const shop = await ShopDetail.findOne({ userId });
            if (shop) return shop;
            
            // Fallback to legacy behavior if userId link is not established yet
            const { Dukandar } = await import("../dukandar/dukandar.model");
            const dukandar = await Dukandar.findById(userId).populate("shopDetails");
            return dukandar ? (dukandar.shopDetails as unknown as ShopDetailDocument) : null;
        }

        if (role === 'customer') {
            const { CustomerModel } = await import("../customer/customer.model");
            const customer = await CustomerModel.findById(userId);
            if (!customer) return null;

            const { Dukandar } = await import("../dukandar/dukandar.model");
            const dukandar = await Dukandar.findById(customer.dukandarId).populate("shopDetails");
            return dukandar ? (dukandar.shopDetails as unknown as ShopDetailDocument) : null;
        }

        return null;
    },

    async getShopById(id: string): Promise<ShopDetailDocument | null> {
        if (!Types.ObjectId.isValid(id)) return null;
        return await ShopDetail.findById(id);
    },

    // ---------------- UPDATE ----------------
    async updateShopDetail(
        id: string,
        payload: UpdateShopDetailDTO
    ): Promise<ShopDetailDocument | null> {
        if (!Types.ObjectId.isValid(id)) return null;

        const processedPayload: any = { ...payload };

        // email, gstNo and website sit under sparse unique indexes, so an empty
        // string cannot be written to them: "" is a real value to an index, and
        // the second shop to clear one would collide with the first.
        //
        // They used to be set to `undefined` here, which kept the index safe but
        // meant the field was simply left out of the update — so a shopkeeper
        // who deleted their GSTIN or email got "Saved successfully" and found
        // the old value still there afterwards. Clearing was the one edit the
        // screen could not perform.
        //
        // $unset removes the key outright, which is what a sparse index wants
        // and what the shopkeeper asked for. Same treatment, and the same
        // reason, as clearing a customer's phone number in customer.service.
        const unset: Record<string, ""> = {};
        for (const key of ["email", "gstNo", "website"] as const) {
            const value = processedPayload[key];
            if (value === "" || value === null) {
                delete processedPayload[key];
                unset[key] = "";
            }
        }

        // Resolve the phone number to use for the upload/delete folder — the
        // update payload may only touch images without resending the phone number.
        const needsUpload =
            processedPayload.shopLogo?.buffer ||
            processedPayload.shopHeader?.buffer ||
            processedPayload.signature?.buffer;

        const toBool = (v: any) => v === true || v === "true";
        const removeLogo = toBool(processedPayload.removeShopLogo);
        const removeHeader = toBool(processedPayload.removeShopHeader);
        const removeSignature = toBool(processedPayload.removeSignature);

        // Removals also need the phone so the ImageKit file can be located/purged.
        const needsPhone = needsUpload || removeLogo || removeHeader || removeSignature;

        let phoneForUpload = processedPayload.phone;

        if (needsPhone && !phoneForUpload) {
            const existing = await ShopDetail.findById(id).select("phone");
            phoneForUpload = existing?.phone;
        }

        // Uploads hard-require a phone (can't build the folder without one);
        // removals only need it to purge the file, so they degrade gracefully.
        if (needsUpload && !phoneForUpload) {
            throw new Error("Cannot upload shop images: phone number not found for this shop");
        }

        // 🖼 Upload shop logo (binary)
        if (processedPayload.shopLogo?.buffer) {
            const uploadResult = await uploadImage(
                processedPayload.shopLogo,
                phoneForUpload,
                "shopLogo"
            );
            processedPayload.shopLogo = uploadResult.url;
        }

        // 🖼 Upload shop header (binary)
        if (processedPayload.shopHeader?.buffer) {
            const uploadResult = await uploadImage(
                processedPayload.shopHeader,
                phoneForUpload,
                "shopHeader"
            );
            processedPayload.shopHeader = uploadResult.url;
        }

        // ✍️ Upload signature (binary)
        if (processedPayload.signature?.buffer) {
            const uploadResult = await uploadImage(
                processedPayload.signature,
                phoneForUpload,
                "signature"
            );
            processedPayload.signature = uploadResult.url;
        }

        // 🗑 Handle removals — clear the DB reference and purge the ImageKit file.
        if (removeLogo) {
            processedPayload.shopLogo = "";
            if (phoneForUpload) await deleteImage(phoneForUpload, "shopLogo");
        }
        if (removeHeader) {
            processedPayload.shopHeader = "";
            if (phoneForUpload) await deleteImage(phoneForUpload, "shopHeader");
        }
        if (removeSignature) {
            processedPayload.signature = "";
            if (phoneForUpload) await deleteImage(phoneForUpload, "signature");
        }

        delete processedPayload.removeShopLogo;
        delete processedPayload.removeShopHeader;
        delete processedPayload.removeSignature;

        // Final safety net: never let a non-string reach the String image fields.
        IMAGE_FIELDS.forEach((key) => normalizeImageField(processedPayload, key));

        return await ShopDetail.findByIdAndUpdate(
            id,
            Object.keys(unset).length
                ? { $set: processedPayload, $unset: unset }
                : processedPayload,
            // runValidators is required — without it Mongoose silently skips schema
            // validators (including the maxlength caps) on findByIdAndUpdate, which
            // is exactly the path the "Add/Edit Shop Details" screen hits on save.
            { new: true, runValidators: true, context: "query" }
        );
    },

    // ---------------- PREFERENCES ----------------
    /**
     * Updates only the shop-wide preferences, resolved from the caller's own
     * account rather than a shop id in the URL.
     *
     * Deliberately not routed through `updateShopDetail`: that path is built for
     * the Edit Shop Details form and carries multipart image upload, removal
     * flags and unique-field sanitising, none of which apply to picking a bill
     * template. Sending a whole shop record to change one enum also invites a
     * lost update — two computers saving different screens would each write back
     * their own stale copy of every other field.
     *
     * Only keys actually present are written, so a screen that changes the
     * template does not blank the languages.
     */
    async updateShopPreferences(
        userId: string,
        role: string,
        prefs: UpdateShopPreferencesDTO
    ): Promise<ShopDetailDocument | null> {
        const shop = await this.getShopDetailsByUser(userId, role);
        if (!shop) return null;

        const update: Record<string, unknown> = {};
        if (prefs.invoiceTemplate !== undefined) update.invoiceTemplate = prefs.invoiceTemplate;
        if (prefs.appLanguage !== undefined) update.appLanguage = prefs.appLanguage;
        if (prefs.declarationLanguage !== undefined) update.declarationLanguage = prefs.declarationLanguage;
        if (prefs.oldGoldMelt !== undefined) update.oldGoldMelt = prefs.oldGoldMelt;

        // Nothing to write — hand back the current document rather than an
        // empty $set, so the caller still gets the shop's stored preferences.
        if (Object.keys(update).length === 0) return shop;

        return await ShopDetail.findByIdAndUpdate(
            shop._id,
            update,
            // runValidators so the enums above actually reject a bad value;
            // without it Mongoose skips validators on findByIdAndUpdate and a
            // typo would propagate to every device the shop uses.
            { new: true, runValidators: true, context: "query" }
        );
    },

    // ---------------- DELETE ----------------
    async deleteShopDetail(id: string): Promise<ShopDetailDocument | null> {
        if (!Types.ObjectId.isValid(id)) return null;
        return await ShopDetail.findByIdAndDelete(id);
    },
};
