import express from "express";
import loginRoutes from "./auth/login/login.routes";
import adminRoutes from "./admin/admin.routes";
import shopDetailRoutes from "./shopDetail/shopDetails.routes";
import dukandarRoutes from "./dukandar/dukandar.routes";
import productRoutes from "./item/item.routes";
import catalogProductRoutes from "./catalogProduct/catalogProduct.routes";
import customerRoutes from "./customer/customer.routes";
import salesRoutes from "./sales/sales.routes";
import metalRateRoutes from "./metal-rate/metalRate.routes";
import invoiceRoutes from "./invoice/invoice.routes";
import orderRoutes from "./order/order.routes";
import purchaseRoutes from "./purchase/purchase.routes";
import purchaseOldGoldRoutes from "./purchaseOldGold/purchaseOldGold.routes";
import platformConfigRoutes from "./platformConfig/platformConfig.routes";
import tutorialRoutes from "./tutorial/tutorial.routes";

const router = express.Router();

// Auth / login related routes
router.use("/login", loginRoutes);

// Admin management routes
router.use("/admin", adminRoutes);

// Shop detail routes
router.use("/shopDetails", shopDetailRoutes);

// Dukandar (owner) routes
router.use("/dukandar", dukandarRoutes);

// Customer routes
router.use("/customer", customerRoutes);

// Catalog Product routes
router.use("/products", catalogProductRoutes);

// Direct item routes
router.use("/items", productRoutes);

// Sales routes
router.use("/sales", salesRoutes);

// Sales routes
router.use("/invoice", invoiceRoutes);

// Metal rate routes
router.use("/metal-rates", metalRateRoutes);

// Order routes
router.use("/orders", orderRoutes);

// Purchase routes (stock purchases for GST/ITC)
router.use("/purchases", purchaseRoutes);

// Old gold bought from a customer — for cash, or as the exchange leg of a sale.
// Produces the printed Declaration / Affidavit. Deliberately NOT wired into the
// sales or GST reports: buying old gold from a customer is not a sale, and the
// statutory treatment of an inward supply from an unregistered person is the
// shop's CA's call, not this app's.
router.use("/purchase-old-gold", purchaseOldGoldRoutes);

// Platform config: GET is public — every app reads it unauthenticated at launch
// — but PUT requires an admin. The per-route guards live in
// platformConfig.routes.ts; this mount is not public wholesale.
router.use("/platform/config", platformConfigRoutes);

// In-app video tutorials. Same public-GET / admin-write split as platform config,
// but a separate endpoint on purpose: this one is fetched lazily when a user opens
// the library, so a growing content payload never slows the launch request that
// carries force-update and the kill switch.
router.use("/tutorials", tutorialRoutes);

export default router;
