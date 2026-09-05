import { Router } from "express";
import { MeltLotController } from "./meltLot.controller";
import { authMiddleware, impersonateMiddleware } from "../../common/middlewares/auth.middleware";
import { blockImpersonatedWrites } from "../../common/middlewares/blockImpersonatedWrites.middleware";

const router = Router();

router.use(authMiddleware);
router.use(impersonateMiddleware);
router.use(blockImpersonatedWrites);

// Defaults to the open lots — everything still waiting on a reading.
router.get("/", MeltLotController.list);
router.get("/:id", MeltLotController.getOne);

// Stage 1: ornaments over the counter, weighed into the pot.
router.post("/", MeltLotController.create);

// The later stages, hours or days apart. Separate routes rather than one
// generic PATCH: each stage has its own preconditions and its own thing it is
// allowed to change, and "test" additionally moves money onto an account.
router.patch("/:id/melt", MeltLotController.recordMelt);
router.patch("/:id/test", MeltLotController.recordTest);

// Only while the lot is still open — see the service for why a credited lot
// cannot be removed.
router.delete("/:id", MeltLotController.remove);

export default router;
