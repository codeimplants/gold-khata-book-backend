import { Router } from "express";
import { PurchaseOldGoldController } from "./purchaseOldGold.controller";
import {
  authMiddleware,
  impersonateMiddleware,
} from "../../common/middlewares/auth.middleware";
import { blockImpersonatedWrites } from "../../common/middlewares/blockImpersonatedWrites.middleware";
import { upload } from "../../common/middlewares/multer";
import {
  MAX_DECLARATION_PHOTOS,
  MAX_ID_PROOF_PHOTOS,
  MAX_ITEM_PHOTOS,
  MAX_WITNESS_PHOTOS,
} from "./purchaseOldGold.service";

const router = Router();

router.use(authMiddleware);
router.use(impersonateMiddleware);
router.use(blockImpersonatedWrites);

router.get("/", PurchaseOldGoldController.list);
router.get("/:id", PurchaseOldGoldController.getById);
router.post("/", PurchaseOldGoldController.create);
router.put("/:id", PurchaseOldGoldController.update);
router.delete("/:id", PurchaseOldGoldController.remove);

router.post(
  "/:id/photos",
  upload.array("photos", MAX_DECLARATION_PHOTOS),
  PurchaseOldGoldController.addPhotos
);
router.delete("/:id/photos/:fileId", PurchaseOldGoldController.removePhoto);

// Photos of one ornament. Addressed by the ornament's own id, never by array
// index: removing the first of three ornaments would otherwise re-point the
// remaining two at each other's photos. See the DeclarationItem type.
router.post(
  "/:id/items/:itemId/photos",
  upload.array("photos", MAX_ITEM_PHOTOS),
  PurchaseOldGoldController.addItemPhotos
);
router.delete(
  "/:id/items/:itemId/photos/:fileId",
  PurchaseOldGoldController.removeItemPhoto
);

// Scans of the seller's own ID documents. Addressed by the entry's own id, for
// the same reason as the ornaments above — see the IdProofEntry type.
router.post(
  "/:id/id-proofs/:idProofId/photos",
  upload.array("photos", MAX_ID_PROOF_PHOTOS),
  PurchaseOldGoldController.addIdProofPhotos
);
router.delete(
  "/:id/id-proofs/:idProofId/photos/:fileId",
  PurchaseOldGoldController.removeIdProofPhoto
);

// Witness ID proof. Addressed by the witness's own id, never by array index —
// see the Witness type for why.
router.post(
  "/:id/witnesses/:witnessId/photos",
  upload.array("photos", MAX_WITNESS_PHOTOS),
  PurchaseOldGoldController.addWitnessPhotos
);
router.delete(
  "/:id/witnesses/:witnessId/photos/:fileId",
  PurchaseOldGoldController.removeWitnessPhoto
);

export default router;
