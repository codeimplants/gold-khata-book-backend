import { promises as fs } from "fs";
import path from "path";
import { Types } from "mongoose";

import { Dukandar } from "./dukandar.model";
import { AppOpenLog } from "./appOpenLog.model";
import { ShopDetail } from "../shopDetail/shopDetails.model";
import { CustomerModel } from "../customer/customer.model";
import { InvoiceModel } from "../invoice/invoice.model";
import { OrderModel } from "../order/order.model";
import { CommunicationLogModel } from "../communication/communication.model";
import { CatalogProductModel } from "../catalogProduct/catalogProduct.model";
import { PurchaseModel } from "../purchase/purchase.model";
import { ItemModel } from "../item/item.model";
import { MetalRateModel } from "../metal-rate/metalRate.model";

/**
 * Writes everything an admin bulk-delete is about to destroy to disk, before a
 * single document is removed.
 *
 * Inherited from SoneBill, where on 21 Aug 2026 an admin bulk-delete removed
 * 31 shops in 29 seconds — 57 invoices, 70 customers, ~Rs 68 lakh of
 * GST-relevant billing — and not one record came back. Every recovery route
 * was checked and every one was closed.
 *
 * The guard is kept here because this deployment is no safer: a self-hosted
 * mongod has no point-in-time restore and no change-stream pre-images unless
 * they are deliberately configured, and a replica-set oplog only reaches back
 * as far as its sizing allows. Schedule a nightly mongodump on the VPS — but
 * restoring a database to undo one bad click is a blunt instrument, so the
 * bulk path carries its own undo: the data leaves as a file before it leaves
 * the database, so reversing a mistake is reading JSON rather than staging a
 * disaster recovery.
 */

/** Override with DELETION_EXPORT_DIR; keep it on a disk that gets backed up. */
export const EXPORT_DIR =
    process.env.DELETION_EXPORT_DIR ?? path.resolve(process.cwd(), "deletion-exports");

export interface ShopDataCounts {
    customers: number;
    invoices: number;
    orders: number;
    communications: number;
    catalogProducts: number;
    purchases: number;
    items: number;
    metalRates: number;
}

/**
 * Whether a shop holds real business records, as opposed to being an empty
 * signup that never billed anyone.
 *
 * Communication logs deliberately do not count. They are activity traces, not
 * the shopkeeper's work, and treating them as data would block exactly the
 * empty-test-account cleanup this path exists to allow.
 *
 * Purchases and catalogue products DO count, added 26 Aug 2026. A purchase is a
 * financial record of stock bought from a wholesaler, and a catalogue is hours
 * of the shopkeeper's own typing — name, purity, making charges and HUID per
 * product. A shop holding either is not an empty signup, but until this was
 * added a shop with a full catalogue and no invoice yet counted as one, and the
 * bulk path would have deleted it without even pausing to be overridden.
 *
 * Items and metal rates are counted for the export but not here: an item row is
 * written from an invoice and never exists without one, and a metal rate is a
 * setting the shopkeeper re-enters in seconds. Neither can make a shop look
 * occupied on its own.
 */
export const hasRealData = (c: ShopDataCounts): boolean =>
    c.customers > 0 ||
    c.invoices > 0 ||
    c.orders > 0 ||
    c.purchases > 0 ||
    c.catalogProducts > 0;

export const countShopData = async (id: string): Promise<ShopDataCounts> => {
    const oid = new Types.ObjectId(id);
    const [
        customers, invoices, orders, communications,
        catalogProducts, purchases, items, metalRates,
    ] = await Promise.all([
        CustomerModel.countDocuments({ dukandarId: oid }),
        InvoiceModel.countDocuments({ userId: oid }),
        OrderModel.countDocuments({ userId: oid }),
        CommunicationLogModel.countDocuments({ dukandarId: oid }),
        CatalogProductModel.countDocuments({ dukandarId: oid }),
        PurchaseModel.countDocuments({ userId: oid }),
        ItemModel.countDocuments({ dukandarId: oid }),
        MetalRateModel.countDocuments({ dukandarId: oid }),
    ]);
    return {
        customers, invoices, orders, communications,
        catalogProducts, purchases, items, metalRates,
    };
};

export interface ShopExport {
    file: string;
    counts: ShopDataCounts;
}

/**
 * Dumps one shop and everything filed under it to a single JSON file.
 *
 * The collections mirror hardDeleteWithCascade exactly. If a collection is ever
 * added to that cascade it must be added here too, or the export silently stops
 * being a complete record of what was destroyed.
 *
 * Throws if anything goes wrong. Callers must treat that as a reason NOT to
 * delete — an export that failed is the difference between a reversible
 * mistake and the 21 Aug incident.
 */
export const exportShopBeforeDelete = async (id: string): Promise<ShopExport> => {
    const oid = new Types.ObjectId(id);

    const dukandar = await Dukandar.findById(oid)
        .populate<{ shopDetails: { _id: Types.ObjectId; shopName?: string } }>("shopDetails")
        .lean();
    if (!dukandar) throw new Error(`dukandar ${id} not found`);

    const shopDetailsId = (dukandar.shopDetails as { _id?: Types.ObjectId } | undefined)?._id;

    const [
        shopDetails, customers, invoices, orders, communications, appOpenLogs,
        catalogProducts, purchases, items, metalRates,
    ] =
        await Promise.all([
            shopDetailsId ? ShopDetail.findById(shopDetailsId).lean() : Promise.resolve(null),
            CustomerModel.find({ dukandarId: oid }).lean(),
            InvoiceModel.find({ userId: oid }).lean(),
            OrderModel.find({ userId: oid }).lean(),
            CommunicationLogModel.find({ dukandarId: oid }).lean(),
            AppOpenLog.find({ dukandarId: oid }).lean(),
            // Added 26 Aug 2026 with the cascade that finally deletes these.
            // An export that omits what the delete destroys is not an undo.
            CatalogProductModel.find({ dukandarId: oid }).lean(),
            PurchaseModel.find({ userId: oid }).lean(),
            ItemModel.find({ dukandarId: oid }).lean(),
            MetalRateModel.find({ dukandarId: oid }).lean(),
        ]);

    const counts: ShopDataCounts = {
        customers: customers.length,
        invoices: invoices.length,
        orders: orders.length,
        communications: communications.length,
        catalogProducts: catalogProducts.length,
        purchases: purchases.length,
        items: items.length,
        metalRates: metalRates.length,
    };

    const payload = {
        exportedAt: new Date().toISOString(),
        reason: "admin bulk delete",
        dukandarId: String(dukandar._id),
        phone: dukandar.phone,
        shopName: (dukandar.shopDetails as { shopName?: string } | undefined)?.shopName ?? "",
        counts,
        // Documents are stored with their original _id values. Because the
        // cascade removes them outright rather than altering them, re-inserting
        // these as-is restores every relationship — customerId, userId and
        // dukandarId all resolve again with no remapping.
        collections: {
            dukandar,
            shopDetails,
            customers,
            invoices,
            orders,
            communications,
            appOpenLogs,
            catalogProducts,
            purchases,
            items,
            metalRates,
        },
    };

    await fs.mkdir(EXPORT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(EXPORT_DIR, `${stamp}_${dukandar.phone}_${String(dukandar._id)}.json`);

    // Write then rename. A half-written file that looks complete is worse than
    // no file at all, because the delete would go ahead trusting it.
    const partial = `${file}.partial`;
    await fs.writeFile(partial, JSON.stringify(payload, null, 2), "utf8");
    await fs.rename(partial, file);

    return { file, counts };
};
