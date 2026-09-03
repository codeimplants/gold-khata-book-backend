import multer from "multer";

const storage = multer.memoryStorage(); // keeps files in memory (good for base64 / imageKit)

/**
 * Upload limits.
 *
 * memoryStorage buffers the whole file in RAM, so without a cap one request can
 * pin arbitrary memory — six unresized phone photos is comfortably 60 MB+ on a
 * server that also runs two other apps. nginx already rejects bodies over 25 MB
 * (`client_max_body_size` on every vhost), so this is the second line of
 * defence: it bounds any single file and the number of files per request.
 *
 * 8 MB per file is deliberately generous. Clients compress before upload
 * (ornament photos are resized to 1600px at quality 0.6, well under 1 MB), so a
 * file near this cap means the client-side pass was skipped or failed — better
 * to accept it and let sharp downsize than to reject a shopkeeper's only record
 * of what they took in.
 */
export const upload = multer({
    storage,
    limits: {
        fileSize: 8 * 1024 * 1024, // 8 MB per file
        files: 6,                  // matches MAX_ORNAMENT_PHOTOS
    },
});

/**
 * Limits for the shop's branding images (logo, header, signature).
 *
 * Separate from `upload` because these arrive uncompressed by design: the app
 * deliberately skips its client-side resize for the logo and header, so the
 * original camera-roll file is what reaches this server and sharp does the one
 * downsize. 10 MB covers a full-resolution photo of a printed shop board;
 * the app checks the same number before uploading, so a file over it is
 * refused instantly rather than after a minute on shop wifi.
 *
 * Three files at 10 MB is 30 MB in the worst case, above nginx's 25 MB
 * `client_max_body_size` — nginx rejects that request first, which is the
 * intended outcome. In practice these are saved one or two at a time.
 */
export const uploadShopImages = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB per file
        files: 3,                   // shopLogo + shopHeader + signature
    },
});
