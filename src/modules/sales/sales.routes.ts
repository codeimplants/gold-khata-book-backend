import { Router } from "express";
import { SalesController } from "./sales.controller";
import { authMiddleware } from "../../common/middlewares/auth.middleware";

const router = Router();

router.use(authMiddleware);
router.get("/", SalesController.getSalesReport);
router.get("/gst-report", SalesController.getGstReport);
router.get("/dashboard-summary", authMiddleware, SalesController.getDashboardSalesSummary);

export default router;
