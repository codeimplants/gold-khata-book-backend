import { Router } from "express";
import { TutorialController } from "./tutorial.controller";
import { authMiddleware } from "../../common/middlewares/auth.middleware";
import { requireAdmin } from "../../common/middlewares/requireAdmin.middleware";

const router = Router();

// Public, like platformConfig's GET. The apps read this unauthenticated, and it
// has to work in guest mode — a shopkeeper trying the app before signing up is
// exactly the person who needs the tutorials. Nothing here is private: it is a
// list of unlisted YouTube ids we are deliberately handing out.
router.get("/", TutorialController.getLibrary);

// Everything below is admin-only. These writes steer content shown inside every
// installed app, so they get the same guard as the admin endpoints — an open
// write here would let anyone point the library at videos of their choosing.
router.get("/admin", authMiddleware, requireAdmin, TutorialController.getAllForAdmin);

router.post("/", authMiddleware, requireAdmin, TutorialController.create);
router.put("/:id", authMiddleware, requireAdmin, TutorialController.update);
router.delete("/:id", authMiddleware, requireAdmin, TutorialController.delete);

router.post("/categories", authMiddleware, requireAdmin, TutorialController.createCategory);
router.put("/categories/:id", authMiddleware, requireAdmin, TutorialController.updateCategory);
router.delete("/categories/:id", authMiddleware, requireAdmin, TutorialController.deleteCategory);

export default router;
