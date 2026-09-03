import { Router } from "express";
import { PlatformConfigController } from "./platformConfig.controller";
import asyncHandler from "../../common/middlewares/asyncHandler.middleware";
import { authMiddleware } from "../../common/middlewares/auth.middleware";
import { requireAdmin } from "../../common/middlewares/requireAdmin.middleware";

const router = Router();

// GET is genuinely public: every app fetches it unauthenticated at launch, and
// it returns only values that already ship inside the binary.
router.get("/", asyncHandler(PlatformConfigController.getConfig));

// PUT is not, and used to be. It was mounted under a "public — no auth
// required" comment that was written for the GET, leaving the write open to
// anyone on the internet. That alone allowed rewriting the support phone and
// email into a phishing number.
//
// It became considerably worse once versionControl.backendUrl and apiKey moved
// into this document: an attacker able to write here could repoint every
// installed app at a server of their choosing, harvest its telemetry, and
// answer version checks with a FORCE_UPDATE whose store URL is theirs. The
// config that steers the apps must be at least as protected as the admin
// endpoints that steer far less.
router.put("/", authMiddleware, requireAdmin, asyncHandler(PlatformConfigController.updateConfig));

export default router;
