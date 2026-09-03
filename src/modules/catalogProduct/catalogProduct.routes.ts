import { Router } from "express";
import { CatalogProductController } from "./catalogProduct.controller";
import { authMiddleware } from "../../common/middlewares/auth.middleware";

const router = Router();

// All catalog routes require authentication (dukandar login)
router.use(authMiddleware);

router.get("/", CatalogProductController.getAll);
router.post("/", CatalogProductController.create);
router.put("/:id", CatalogProductController.update);
router.delete("/:id", CatalogProductController.delete);

export default router;
