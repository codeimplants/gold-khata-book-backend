import { Router } from "express";
import { CustomerController } from "./customer.controller";
import { authMiddleware, impersonateMiddleware } from "../../common/middlewares/auth.middleware";
import { requireAdmin } from "../../common/middlewares/requireAdmin.middleware";
import { blockImpersonatedWrites } from "../../common/middlewares/blockImpersonatedWrites.middleware";
import invoiceRoutes from "../invoice/invoice.routes";
import { upload } from "../../common/middlewares/multer";

const router = Router();

router.use(authMiddleware);
router.use(impersonateMiddleware);
router.use(blockImpersonatedWrites);

router.post("/", CustomerController.createCustomer);
router.get("/", CustomerController.getAllCustomers);
router.get("/dukandar/:dukandarId", requireAdmin, CustomerController.getCustomersByDukandarId);
router.get("/:id", CustomerController.getCustomerById);
router.put("/:id", CustomerController.updateCustomer);
router.delete("/:id", CustomerController.deleteCustomer);

// Profile photo. Separate from the JSON update so the form can save a customer
// without a photo, then attach one — a new customer has no id to upload against
// until it exists.
router.post(
  "/:id/photo",
  upload.single("photo"),
  CustomerController.setProfilePhoto
);
router.delete("/:id/photo", CustomerController.removeProfilePhoto);

// Invoice routes scoped under a customer
router.use("/:customerId/invoices", invoiceRoutes);

export default router;
