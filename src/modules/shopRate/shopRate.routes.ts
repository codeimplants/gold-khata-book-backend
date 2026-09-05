import { Router } from "express";
import { ShopRateController } from "./shopRate.controller";
import { authMiddleware, impersonateMiddleware } from "../../common/middlewares/auth.middleware";
import { blockImpersonatedWrites } from "../../common/middlewares/blockImpersonatedWrites.middleware";

const router = Router();

router.use(authMiddleware);
router.use(impersonateMiddleware);
router.use(blockImpersonatedWrites);

// Defaults to today. `?date=YYYY-MM-DD` reads or sets another day, which is
// what makes a back-dated bill explainable by the rate that was in force.
router.get("/", ShopRateController.get);
router.put("/", ShopRateController.set);
router.delete("/", ShopRateController.clear);

export default router;
