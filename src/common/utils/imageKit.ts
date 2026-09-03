import ImageKit from "imagekit";
import dotenv from "dotenv";
import sharp from "sharp";

dotenv.config();

const publicKey = process.env.IMAGEKIT_PUBLIC_KEY;
const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
const urlEndpoint = process.env.IMAGEKIT_URL_ENDPOINT;
const environment = process.env.NODE_ENV;
const storage = process.env.IMAGEKIT_STORAGE_APP;

let imagekit: any = null;
try {
    imagekit = new ImageKit({
        publicKey: publicKey || "",
        privateKey: privateKey || "",
        urlEndpoint: urlEndpoint || "",
    });
} catch (error: any) {
    console.error("ImageKit initialization failed:", error.message);
    console.log("Using fallback credentials for development");
}

const optimizeImage = async (buffer: Buffer, options = {}) => {
    const { quality = 80, width = 500, height = 500, format = "webp" }: any = options;

    try {
        let sharpInstance = sharp(buffer);

        // Resize if dimensions provided
        if (width || height) {
            sharpInstance = sharpInstance.resize(width, height, {
                fit: "inside",
                withoutEnlargement: true,
            });
        }

        // Convert to WebP for better compression
        if (format === "webp") {
            sharpInstance = sharpInstance.webp({ quality });
        } else if (format === "jpeg") {
            sharpInstance = sharpInstance.jpeg({ quality });
        } else if (format === "png") {
            sharpInstance = sharpInstance.png({ quality });
        }

        return await sharpInstance.toBuffer();
    } catch (error) {
        console.error("Image optimization error:", error);
        return buffer; // Return original if optimization fails
    }
};

/**
 * Storage size per branding image, keyed by the `category` the shop-details
 * service passes in.
 *
 * These were all 500x500 until 2026-08-25, which is where the "our header comes
 * out blurry" reports came from. `fit: "inside"` treats 500x500 as a bounding
 * box, so a 3904x1088 banner was stored as 500x139 — then printed across the
 * full width of an A4 bill, roughly a 5x upscale of an image that had already
 * been through a lossy pass. The shop's name, which is the one thing on the
 * banner, is the first thing to smear.
 *
 * The numbers are what the print path can actually resolve, not the largest
 * thing a phone can produce:
 *
 * - shopHeader 2480px — A4 width at 300 DPI (8.27in x 300). The banner is the
 *   only image on a bill that spans the page, so it is the only one that needs
 *   the full sheet's worth of pixels.
 * - shopLogo 1200px — printed in a ~52px box (~215px at 300 DPI) but also
 *   rasterised for thermal receipts and shown full-screen in the picker's
 *   preview, so it gets headroom over what any single use needs.
 * - signature 500px — unchanged. It prints in a 90x32 box and is usually drawn
 *   in-app rather than photographed; more pixels would be dead weight in every
 *   bill PDF.
 *
 * Quality is 92 rather than 85 for the two photographic ones: WebP artefacts
 * around the high-contrast edges of Devanagari lettering are visible on paper
 * even when they are not on screen, and the size difference is tens of KB.
 *
 * `withoutEnlargement` still applies, so a shop that uploads a small logo keeps
 * exactly what it uploaded — nothing here upscales.
 */
const BRANDING_IMAGE_SPECS: Record<string, { size: number; quality: number }> = {
    shopheader: { size: 2480, quality: 92 },
    shoplogo: { size: 1200, quality: 92 },
    signature: { size: 500, quality: 85 },
};

const DEFAULT_BRANDING_SPEC = { size: 500, quality: 85 };

export const uploadImage = async (file: any, phone: number | string, category: string): Promise<any> => {
    if (!imagekit) {
        throw new Error(
            "ImageKit not initialized. Please check your environment variables."
        );
    }

    try {
        // Optimize the image, at the resolution this particular image is
        // actually printed at — see BRANDING_IMAGE_SPECS.
        const spec = BRANDING_IMAGE_SPECS[category.toLowerCase()] ?? DEFAULT_BRANDING_SPEC;
        const optimizedBuffer = await optimizeImage(file.buffer, {
            quality: spec.quality,
            width: spec.size,
            height: spec.size,
            format: "webp",
        });

        const folder = `${environment}/${storage}/${phone}/${category.toLowerCase()}`;
        const fileName = `${category}.webp`;

        // Upload to ImageKit
        const uploadResponse = await imagekit.upload({
            file: optimizedBuffer,
            fileName,
            folder,
            useUniqueFileName: false,
            overwriteFile: true, // re-uploads replace the existing file at this path instead of piling up
        });

        // Cache-bust the delivered URL.
        //
        // This upload pins the filename to `<category>.webp` and overwrites in
        // place, so without this every re-upload returns a byte-identical URL.
        // That is a stale-image bug at two layers at once: React Native's Image
        // cache and ImageKit's CDN edges both key on the URL, and neither is
        // purged by an overwrite. It bites hardest on the remove-then-upload-
        // again path, where the object is deleted and recreated at the same
        // URL — a request landing mid-replacement can be served a partially
        // replaced object, which decodes as the real image with a blank strip
        // where the missing rows should be.
        //
        // A version parameter fixes it without giving up the single-file
        // storage layout: the path still holds exactly one object (no orphans
        // piling up per shop), while every save hands out a URL nothing has
        // cached yet. `uploadOrnamentPhoto` needs none of this — it uses unique
        // filenames, so its URLs are already distinct per upload.
        return {
            url: `${uploadResponse.url}?v=${Date.now()}`,
            fileId: uploadResponse.fileId,
            fileName: uploadResponse.name,
        };
    } catch (error) {
        console.error("ImageKit upload error:", error);
        throw new Error("Failed to upload image");
    }
};

/**
 * Uploads one old-ornament photo attached to a declaration.
 *
 * Deliberately NOT `uploadImage`: that one pins the filename to `<category>.webp`
 * with `overwriteFile: true`, which is correct for the shop logo/header/signature
 * (re-uploading replaces the single current image) but would make every photo in
 * a set overwrite the previous one. Here each photo is a distinct object, so
 * `useUniqueFileName` is on and each declaration gets its own folder.
 *
 * Also resized to 1024px rather than 500px — these are evidence of what was
 * bought, and 500px is too small to make out an ornament.
 */
export const uploadOrnamentPhoto = async (
    file: any,
    phone: number | string,
    /** Branch for the record that owns these photos: purchase-old-gold | orders | invoices. */
    section: "purchase-old-gold" | "orders" | "invoices",
    /** The owning record's number, e.g. POG-7 / ORD-42 / INV-19. */
    reference: string,
    /**
     * Optional extra segment under the record's folder. Used to keep photos of
     * the items SOLD (`items/1`) apart from photos of the old ornaments taken
     * in against the same bill, which otherwise land in one undifferentiated
     * folder and cannot be told apart afterwards — the exact question these
     * photos exist to answer.
     */
    subfolder?: string
): Promise<{ url: string; fileId: string; fileName: string }> => {
    if (!imagekit) {
        throw new Error(
            "ImageKit not initialized. Please check your environment variables."
        );
    }

    try {
        const optimizedBuffer = await optimizeImage(file.buffer, {
            quality: 85,
            width: 1024,
            height: 1024,
            format: "webp",
        });

        // Branch per source, so a photo's folder says where it came from:
        //   <env>/<app>/<shopPhone>/orders/ORD-42/
        //   <env>/<app>/<shopPhone>/invoices/INV-19/
        //   <env>/<app>/<shopPhone>/purchase-old-gold/POG-7/
        //   <env>/<app>/<shopPhone>/invoices/INV-19/items/0/   (item photos)
        const folder = subfolder
            ? `${environment}/${storage}/${phone}/${section}/${reference}/${subfolder}`
            : `${environment}/${storage}/${phone}/${section}/${reference}`;

        const uploadResponse = await imagekit.upload({
            file: optimizedBuffer,
            fileName: "ornament.webp",
            folder,
            useUniqueFileName: true,
            overwriteFile: false,
        });

        return {
            url: uploadResponse.url,
            fileId: uploadResponse.fileId,
            fileName: uploadResponse.name,
        };
    } catch (error) {
        console.error("ImageKit ornament photo upload error:", error);
        throw new Error("Failed to upload ornament photo");
    }
};

/**
 * Uploads a customer's profile photo.
 *
 * Foldered by the two phone numbers rather than by database ids:
 *   <env>/<app>/<shopPhone>/customers/<customerPhone>/profile.webp
 *
 * A shopkeeper looking at ImageKit can find a customer's photo from the two
 * numbers they already know, without going through the database for an
 * ObjectId. The trade is that changing a customer's phone number strands the
 * old folder — see `deleteCustomerPhoto`, which is given the old number for
 * exactly that reason.
 *
 * Fixed filename with `overwriteFile`, like the shop logo and unlike ornament
 * photos: a customer has one current profile photo, and re-uploading replaces
 * it instead of accumulating.
 */
export const uploadCustomerPhoto = async (
    file: any,
    shopPhone: number | string,
    customerPhone: number | string
): Promise<{ url: string; fileId: string; fileName: string }> => {
    if (!imagekit) {
        throw new Error(
            "ImageKit not initialized. Please check your environment variables."
        );
    }

    try {
        const optimizedBuffer = await optimizeImage(file.buffer, {
            quality: 85,
            width: 500,
            height: 500,
            format: "webp",
        });

        const folder = `${environment}/${storage}/${shopPhone}/customers/${customerPhone}`;

        const uploadResponse = await imagekit.upload({
            file: optimizedBuffer,
            fileName: "profile.webp",
            folder,
            useUniqueFileName: false,
            overwriteFile: true,
        });

        return {
            url: uploadResponse.url,
            fileId: uploadResponse.fileId,
            fileName: uploadResponse.name,
        };
    } catch (error) {
        console.error("ImageKit customer photo upload error:", error);
        throw new Error("Failed to upload customer photo");
    }
};

/**
 * Copies a customer's profile photo to the folder for a new phone number.
 *
 * Folder paths are keyed on the phone number so a shopkeeper can find a photo
 * from the two numbers they know. Re-keying a customer would otherwise leave
 * the photo filed under a number that customer no longer has — the exact thing
 * the layout exists to prevent.
 *
 * Copy rather than move, deliberately. A move is one call and tidier, but it
 * opens a window: the URL changes the instant the file relocates, so if the
 * database repoint then fails, every stored URL — the customer's and the
 * `customerSnapshot.photoUrl` on each of their declarations — points at a path
 * that no longer exists. Copying leaves the original in place, so both the old
 * and new URLs resolve for as long as it takes the caller to repoint and delete
 * the original. No interleaving of failures can produce a broken image; the
 * worst case is a duplicate file, which is invisible to the shopkeeper.
 *
 * Bytes still never travel through this server — ImageKit copies server-side.
 *
 * Returns the new URL, or null when there was nothing at the old path.
 */
export const copyCustomerPhoto = async (
    shopPhone: number | string,
    oldCustomerPhone: number | string,
    newCustomerPhone: number | string
): Promise<string | null> => {
    if (!imagekit) return null;
    if (String(oldCustomerPhone) === String(newCustomerPhone)) return null;

    try {
        const base = `${environment}/${storage}/${shopPhone}/customers`;
        const from = `${base}/${oldCustomerPhone}`;
        const to = `${base}/${newCustomerPhone}`;

        const files = await imagekit.listFiles({ path: from, name: "profile.webp" });
        const existing = (files || [])[0];
        if (!existing) return null;

        await imagekit.copyFile({
            sourceFilePath: existing.filePath,
            destinationPath: to,
        });

        // Read the URL back rather than string-building it, so a change to
        // ImageKit's URL scheme cannot silently produce a dead link.
        const copied = await imagekit.listFiles({ path: to, name: "profile.webp" });
        return (copied || [])[0]?.url || null;
    } catch (error) {
        console.error("ImageKit customer photo copy error:", error);
        return null;
    }
};

/**
 * Removes a customer's profile photo by folder rather than fileId.
 *
 * `overwriteFile: true` keeps the same path but mints a new fileId on every
 * re-upload, so a stored fileId can be stale. Addressing the path is what
 * reliably clears it.
 */
export const deleteCustomerPhoto = async (
    shopPhone: number | string,
    customerPhone: number | string
): Promise<void> => {
    if (!imagekit) return;

    try {
        const folder = `${environment}/${storage}/${shopPhone}/customers/${customerPhone}`;
        const files = await imagekit.listFiles({ path: folder, name: "profile.webp" });
        for (const f of files || []) {
            if (f.fileId) await imagekit.deleteFile(f.fileId);
        }
    } catch (error) {
        console.error("ImageKit customer photo delete error:", error);
        // Non-fatal, same as deleteImage: clearing the DB reference is what the
        // shopkeeper actually sees.
    }
};

/**
 * Deletes a single image by its ImageKit fileId.
 *
 * `deleteImage` below can only address the fixed `<category>.webp` path, so it
 * cannot remove one photo out of a set. Non-fatal on failure, same rationale as
 * `deleteImage`: dropping the DB reference is what the user actually sees.
 */
export const deleteImageByFileId = async (fileId: string): Promise<void> => {
    if (!imagekit || !fileId) return;

    try {
        await imagekit.deleteFile(fileId);
    } catch (error) {
        console.error("ImageKit delete-by-fileId error:", error);
    }
};

export const deleteImage = async (phone: number | string, category: string): Promise<void> => {
    if (!imagekit) return;

    try {
        const folder = `${environment}/${storage}/${phone}/${category.toLowerCase()}`;
        const fileName = `${category}.webp`;

        const files = await imagekit.listFiles({ path: folder, name: fileName });
        for (const f of files || []) {
            if (f.fileId) await imagekit.deleteFile(f.fileId);
        }
    } catch (error) {
        console.error("ImageKit delete error:", error);
        // Non-fatal: clearing the DB reference is what matters to the user.
    }
};

/**
 * Removes everything a shop ever uploaded, in one call.
 *
 * Every file this module writes lands under `<env>/<storage>/<key>/…`, whatever
 * wrote it: shop branding, customer profile photos, invoice item photos, and a
 * declaration's ornament, ID-proof and witness images. Deleting that folder is
 * the only way to be sure none is left, and it is the only operation that stays
 * correct when a new kind of upload is added — a per-category list has to be
 * remembered, and this one cannot be forgotten.
 *
 * Until 26 Aug 2026 deleting an account removed three files by name — the logo,
 * the header and the signature — and left every other image on ImageKit for
 * good, including photographs of sellers' Aadhaar cards taken for old-gold
 * declarations. Those are exactly the files that should not outlive the shop
 * that collected them.
 *
 * `key` is the shop's storage key, which is its phone number where a shop
 * profile exists and its userId where one does not — see resolveStorageKey.
 * Callers should purge both, since a shop can have written under either.
 *
 * Guarded rather than trusting the caller: an empty key, or one carrying a
 * slash or a `..`, would resolve to the *parent* folder and take every shop's
 * files with it. Those are refused outright.
 *
 * Never throws. A file left on ImageKit is a billing detail; a delete that
 * fails because of it is a user-visible error about something else entirely.
 */
export const deleteShopFolder = async (key: string | number): Promise<void> => {
    if (!imagekit) return;

    const trimmed = String(key ?? "").trim();
    if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
        console.error(`ImageKit folder purge refused for unsafe key: ${JSON.stringify(key)}`);
        return;
    }

    const folder = `${environment}/${storage}/${trimmed}`;

    try {
        await imagekit.deleteFolder(folder);
        console.log(`[imagekit] purged folder ${folder}`);
    } catch (error: any) {
        // A shop that never uploaded anything has no folder, which the API
        // reports as a 404. That is the expected outcome, not a failure.
        const status = error?.$ResponseMetadata?.statusCode ?? error?.httpStatusCode;
        if (status === 404) return;
        console.error(`ImageKit folder purge error for ${folder}:`, error);
    }
};

export default imagekit;
