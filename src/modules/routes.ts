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
import retailerAccountRoutes from "./retailerAccount/retailerAccount.routes";
import meltLotRoutes from "./meltLot/meltLot.routes";
import shopRateRoutes from "./shopRate/shopRate.routes";
import purchaseRoutes from "./purchase/purchase.routes";
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

// A retailer's held cash and melt credit — value the wholesaler is holding
// that is not against any particular bill. Separate from /orders on purpose:
// a lump sum may cover several bills or none yet, and a melt lot may be split
// across bills or taken as cash.
router.use("/retailer-account", retailerAccountRoutes);

// Old ornaments moving through the shop. A lot is weighed into the pot, melted
// and tested on separate days, so it is a record with stages rather than a form
// — and the credit only reaches /retailer-account when the test closes it.
router.use("/melt-lots", meltLotRoutes);

// The rate the shop is actually dealing at today, which is routinely not the
// live market feed. Absent for a day means "use live" — see the model.
router.use("/shop-rate", shopRateRoutes);

// Purchase routes (stock purchases for GST/ITC)
router.use("/purchases", purchaseRoutes);

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
