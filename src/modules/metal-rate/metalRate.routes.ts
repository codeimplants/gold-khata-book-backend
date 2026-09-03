import { Router } from "express";
import { MetalRateController } from "./metalRate.controller";

const router = Router();

// No auth required — rates come from the external live API (public endpoint)
// Works in both guest mode and logged-in mode
router.get("/", MetalRateController.getMetalRates);

// PUT kept for compatibility but it just re-fetches live rates now
// router.put("/", MetalRateController.updateMetalRates);

export default router;
