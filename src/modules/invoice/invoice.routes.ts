import { Router } from "express";
import { InvoiceController } from "./invoice.controller";
import { authMiddleware, impersonateMiddleware } from "../../common/middlewares/auth.middleware";
import { blockImpersonatedWrites } from "../../common/middlewares/blockImpersonatedWrites.middleware";
import { upload } from "../../common/middlewares/multer";

const router = Router({ mergeParams: true });

// Public route for invoice number generation (Guest Mode support)
router.get("/next-number", InvoiceController.getNextInvoiceNumber);

router.use(authMiddleware);
router.use(impersonateMiddleware);
router.use(blockImpersonatedWrites);

router.post("/", InvoiceController.createInvoice);
router.get("/", InvoiceController.getAllInvoices);
router.get("/trash", InvoiceController.getTrashedInvoices);
router.get("/:id", InvoiceController.getInvoiceById);
router.put("/:id", InvoiceController.updateInvoice);
router.delete("/:id", InvoiceController.deleteInvoice);
router.patch("/:id/trash", InvoiceController.trashInvoice);
router.patch("/:id/restore", InvoiceController.restoreInvoice);

// Photos of the old ornaments taken in against this invoice. A full-payment
// exchange is an Invoice, not an Order, so it needs its own upload path.
router.post(
  "/:id/ornament-photos",
  upload.array("photos", 6),
  InvoiceController.addOrnamentPhotos
);
router.delete(
  "/:id/ornament-photos/:fileId",
  InvoiceController.removeOrnamentPhoto
);

// Photos of the items SOLD on this invoice, one set per item. Addressed by the
// item's index because invoice items have no _id — see InvoiceItemSchema.
router.post(
  "/:id/items/:itemIndex/photos",
  upload.array("photos", 4),
  InvoiceController.addItemPhotos
);
router.delete(
  "/:id/items/:itemIndex/photos/:fileId",
  InvoiceController.removeItemPhoto
);

// Photos of ONE ornament taken in against this record. Separate from
// /ornament-photos, which is a single set for the exchange as a whole and is
// how every exchange was recorded before this - those stay and keep working.
// Addressed by index, like items, because exchange rows carry no _id.
router.post(
  "/:id/exchanges/:exchangeIndex/photos",
  upload.array("photos", 4),
  InvoiceController.addExchangePhotos
);
router.delete(
  "/:id/exchanges/:exchangeIndex/photos/:fileId",
  InvoiceController.removeExchangePhoto
);

export default router;
