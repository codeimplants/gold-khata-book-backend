import { Router } from "express";
import { RetailerAccountController } from "./retailerAccount.controller";
import { authMiddleware, impersonateMiddleware } from "../../common/middlewares/auth.middleware";
import { blockImpersonatedWrites } from "../../common/middlewares/blockImpersonatedWrites.middleware";

const router = Router();

router.use(authMiddleware);
router.use(impersonateMiddleware);
router.use(blockImpersonatedWrites);

// Everything hangs off the retailer, because that is what the balances belong
// to — an order is only ever the thing a movement is applied TO.
router.get("/:customerId", RetailerAccountController.getAccount);

// Cash in, held rather than applied.
router.post("/:customerId/cash", RetailerAccountController.receiveCash);
// Held cash drawn down onto an order at the rate of the day it is allocated.
router.post("/:customerId/cash/allocate", RetailerAccountController.allocateCash);
router.post("/:customerId/cash/refund", RetailerAccountController.refundCash);

// Melt credit in, then drawn down onto an order or taken out.
router.post("/:customerId/melt", RetailerAccountController.creditMelt);
router.post("/:customerId/melt/apply", RetailerAccountController.applyMeltCredit);
router.post("/:customerId/melt/payout", RetailerAccountController.payOutMelt);

export default router;
