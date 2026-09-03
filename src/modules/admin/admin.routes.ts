import { Router } from "express";
import { AdminController } from "./admin.controller";
import asyncHandler from "../../common/middlewares/asyncHandler.middleware";
import { authMiddleware } from "../../common/middlewares/auth.middleware";
import { requireAdmin } from "../../common/middlewares/requireAdmin.middleware";

const router = Router();

router.post("/", authMiddleware, requireAdmin, asyncHandler(AdminController.createAdmin));
router.get("/", authMiddleware, requireAdmin, asyncHandler(AdminController.getAllAdmins));
// These three were reachable without a token: any caller could read, modify or
// delete an admin account by id. Guarded now to match the two routes above,
// which were always protected — the gap looks like an oversight rather than a
// decision. No client calls them, so nothing depended on the old behaviour.
router.get("/:id", authMiddleware, requireAdmin, asyncHandler(AdminController.getAdminById));
router.put("/:id", authMiddleware, requireAdmin, asyncHandler(AdminController.updateAdmin));
router.delete("/:id", authMiddleware, requireAdmin, asyncHandler(AdminController.deleteAdmin));

export default router;