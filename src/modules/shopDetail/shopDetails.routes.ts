import { Router } from "express";
import asyncHandler from "../../common/middlewares/asyncHandler.middleware";
import { ShopDetailController } from "./shopDetails.controller";
import { requireAdmin } from "../../common/middlewares/requireAdmin.middleware";
import { authMiddleware, impersonateMiddleware } from "../../common/middlewares/auth.middleware";
import { blockImpersonatedWrites } from "../../common/middlewares/blockImpersonatedWrites.middleware";
import { uploadShopImages } from "../../common/middlewares/multer";

const router = Router();
router.use(authMiddleware);
router.use(impersonateMiddleware);
router.use(blockImpersonatedWrites);

router.post(
    "/",
    uploadShopImages.fields([
        { name: "shopLogo", maxCount: 1 },
        { name: "shopHeader", maxCount: 1 },
        { name: "signature", maxCount: 1 },
    ]),
    asyncHandler(ShopDetailController.createShopDetails)
);
router.get("/", asyncHandler(ShopDetailController.getShopDetails));

// MUST stay above the "/:id" routes below. Express matches in registration
// order, so a PUT to /preferences registered after "/:id" would be swallowed by
// it with id="preferences" — a 404 (or worse, a cast error) instead of a save.
// JSON body, not multipart: there are no files here, so it deliberately skips
// the uploadShopImages middleware the two form routes need.
router.put("/preferences", asyncHandler(ShopDetailController.updateShopPreferences));
router.delete("/:id", requireAdmin, asyncHandler(ShopDetailController.deleteShopDetails));
router.get("/:id", asyncHandler(ShopDetailController.getShopDetailsById));
router.put(
    "/:id",
    uploadShopImages.fields([
        { name: "shopLogo", maxCount: 1 },
        { name: "shopHeader", maxCount: 1 },
        { name: "signature", maxCount: 1 },
    ]),
    asyncHandler(ShopDetailController.updateShopDetails)
);

export default router;
