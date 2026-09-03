import { Router } from "express";
import { OrderController } from "./order.controller";
import { authMiddleware, impersonateMiddleware } from "../../common/middlewares/auth.middleware";
import { blockImpersonatedWrites } from "../../common/middlewares/blockImpersonatedWrites.middleware";
import { upload } from "../../common/middlewares/multer";

const router = Router();

// All routes require authentication
router.use(authMiddleware);
router.use(impersonateMiddleware);
router.use(blockImpersonatedWrites);

// Create order
router.post("/", OrderController.createOrder);

// Get all orders (with optional filters)
router.get("/", OrderController.getAllOrders);

// Get trashed orders (must be before /:id)
router.get("/trash", OrderController.getTrashedOrders);

// Get order by ID
router.get("/:id", OrderController.getOrderById);

// Add payment to order
router.post("/:id/payments", OrderController.addPayment);

// Update payment
router.put("/:id/payments/:paymentId", OrderController.updatePayment);

// Delete payment
router.delete("/:id/payments/:paymentId", OrderController.deletePayment);

// Get payment history
router.get("/:id/payments", OrderController.getPaymentHistory);

// Update order
router.patch("/:id", OrderController.updateOrder);

// Complete order
router.post("/:id/complete", OrderController.completeOrder);

// Unified complete advance order (Adds payment + Creates Invoice + Completes Order)
router.post("/complete-advance-order", OrderController.unifiedCompleteOrder);

// Cancel order
router.post("/:id/cancel", OrderController.cancelOrder);

// Delete order
router.delete("/:id", OrderController.deleteOrder);

// Photos of the old ornaments taken in against this order
router.post(
  "/:id/ornament-photos",
  upload.array("photos", 6),
  OrderController.addOrnamentPhotos
);
router.delete(
  "/:id/ornament-photos/:fileId",
  OrderController.removeOrnamentPhoto
);

// Photos of the items on this order, one set per item, addressed by index —
// order items have no _id. See OrderItemSchema.
router.post(
  "/:id/items/:itemIndex/photos",
  upload.array("photos", 4),
  OrderController.addItemPhotos
);
router.delete(
  "/:id/items/:itemIndex/photos/:fileId",
  OrderController.removeItemPhoto
);

// Photos of ONE ornament taken in against this record. Separate from
// /ornament-photos, which is a single set for the exchange as a whole and is
// how every exchange was recorded before this - those stay and keep working.
// Addressed by index, like items, because exchange rows carry no _id.
router.post(
  "/:id/exchanges/:exchangeIndex/photos",
  upload.array("photos", 4),
  OrderController.addExchangePhotos
);
router.delete(
  "/:id/exchanges/:exchangeIndex/photos/:fileId",
  OrderController.removeExchangePhoto
);

// Soft-delete (trash) and restore
router.patch("/:id/trash", OrderController.trashOrder);
router.patch("/:id/restore", OrderController.restoreOrder);

export default router;
