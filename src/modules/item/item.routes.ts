import { Router } from "express";
import { ItemController } from "./item.controller";
import { authMiddleware } from "../../common/middlewares/auth.middleware";

const router = Router();

router.use(authMiddleware);

router.post("/", authMiddleware, ItemController.createItem);
router.get("/", authMiddleware, ItemController.getAllItems);
router.put("/:id", ItemController.updateItem);
router.delete("/:id", ItemController.deleteItem);

export default router;
