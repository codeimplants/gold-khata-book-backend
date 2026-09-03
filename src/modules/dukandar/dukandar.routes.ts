import { Router } from "express";
import { DukandarController } from "./dukandar.controller";
import { requireAdmin } from "../../common/middlewares/requireAdmin.middleware";
import { authMiddleware } from "../../common/middlewares/auth.middleware";
import { requireDukandar } from "../../common/middlewares/requireDukandar.middleware";
import { CommunicationController } from "../communication/communication.controller";

const router = Router();

router.post("/", authMiddleware, requireAdmin, DukandarController.createDukandar);
router.get("/", authMiddleware, requireAdmin, DukandarController.getAllDukandars);
// Static routes must be registered before /:id to avoid Express matching them as id params
router.get("/stats", authMiddleware, requireAdmin, DukandarController.getAllDukandarsWithStats);
router.get("/analytics", authMiddleware, requireAdmin, DukandarController.getAdminAnalytics);
router.get("/deleted-log", authMiddleware, requireAdmin, DukandarController.getDeletedUserLogs);
router.post("/app-open", authMiddleware, requireDukandar, DukandarController.recordAppOpen);
router.post("/bulk-delete", authMiddleware, requireAdmin, DukandarController.bulkDeleteDukandars);
// Self-service account deletion (App Store Guideline 5.1.1(v)). Must stay above
// "/:id" so Express does not treat "me" as an id, and must NOT require admin —
// the target is taken from the caller's own JWT.
router.delete("/me", authMiddleware, requireDukandar, DukandarController.deleteOwnAccount);
router.delete("/:id", authMiddleware, requireAdmin, DukandarController.deleteDukandar);
// Were reachable without a token, unlike every other route in this file
// including the DELETE directly above. requireAdmin rather than plain
// authMiddleware because neither is called by any client, so the restrictive
// choice costs nothing. If a shop owner ever needs to read or edit their own
// record, add it scoped to the caller's own JWT the way "/me" above is, rather
// than widening these.
router.get("/:id", authMiddleware, requireAdmin, DukandarController.getDukandarById);
router.put("/:id", authMiddleware, requireAdmin, DukandarController.updateDukandar);
router.get("/:id/stats", authMiddleware, requireAdmin, DukandarController.getDukandarStats);
router.get("/:id/customers", authMiddleware, DukandarController.getCustomersByDukandarId);
router.get("/:id/communications", authMiddleware, requireAdmin, CommunicationController.getLogs);
router.post("/:id/communications", authMiddleware, requireAdmin, CommunicationController.addLog);
// Scoped by BOTH ids — see CommunicationService.updateLog for why.
router.put("/:id/communications/:logId", authMiddleware, requireAdmin, CommunicationController.updateLog);
router.delete("/:id/communications/:logId", authMiddleware, requireAdmin, CommunicationController.deleteLog);

export default router;

