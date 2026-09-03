import { Router } from "express";
import { PurchaseController } from "./purchase.controller";
import {
  authMiddleware,
  impersonateMiddleware,
} from "../../common/middlewares/auth.middleware";
import { blockImpersonatedWrites } from "../../common/middlewares/blockImpersonatedWrites.middleware";

const router = Router();

router.use(authMiddleware);
router.use(impersonateMiddleware);
router.use(blockImpersonatedWrites);

router.get("/", PurchaseController.list);
router.post("/", PurchaseController.create);
router.put("/:id", PurchaseController.update);
router.delete("/:id", PurchaseController.remove);

export default router;
