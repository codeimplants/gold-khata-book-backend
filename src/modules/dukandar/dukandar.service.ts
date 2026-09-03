import { HydratedDocument, Types } from "mongoose";
import { Dukandar } from "./dukandar.model";
import { AppOpenLog } from "./appOpenLog.model";
import type { IDukandar, CreateDukandarDTO, UpdateDukandarDTO, DeviceInfo } from "./dukandar.types";
import { mergeLocation, type GeoLocation } from "../../common/utils/geoip";
import { CustomerService } from "../customer/customer.service";
import { ShopDetailService } from "../shopDetail/shopDetails.service";
import { InvoiceModel } from "../invoice/invoice.model";
import { OrderModel } from "../order/order.model";
import { CustomerModel } from "../customer/customer.model";
import { PurchaseOldGoldModel } from "../purchaseOldGold/purchaseOldGold.model";
import { CounterModel } from "../../common/models/Counter.model";
import { CommunicationService } from "../communication/communication.service";
import { deleteShopFolder } from "../../common/utils/imageKit";
import { ShopDetail } from "../shopDetail/shopDetails.model";
import { CatalogProductModel } from "../catalogProduct/catalogProduct.model";
import { PurchaseModel } from "../purchase/purchase.model";
import { ItemModel } from "../item/item.model";
import { MetalRateModel } from "../metal-rate/metalRate.model";
import { DeletedUserLogModel } from "./deletedUserLog.model";
import Admin from "../admin/admin.model";
import { AppError } from "../../common/errors/AppError";
import {
    EXPORT_DIR,
    countShopData,
    exportShopBeforeDelete,
    hasRealData,
    type ShopDataCounts,
} from "./deletionExport";

export type DukandarDocument = HydratedDocument<IDukandar>;

/**
 * The account Apple's reviewers sign in with. It is a real dukandar row and
 * always will be this number, but it is not a customer and must never read as
 * an unnamed shop on a dashboard, so it carries a fixed label instead of
 * whatever shopName the reviewers happened to leave behind.
 */
const DEMO_ACCOUNT_PHONE = 1234567890;
const DEMO_ACCOUNT_NAME = "App Review Demo";

/** Fallback label for an admin whose record has no name set. */
const ADMIN_FALLBACK_NAME = "Platform Admin";

/**
 * Most shops one bulk-delete request may remove.
 *
 * The 21 Aug 2026 incident deleted 31 in a single call. A cap cannot stop a
 * determined mistake, but it turns one runaway action into several deliberate
 * ones — and gives whoever is clicking a chance to notice between them.
 */
const MAX_BULK_DELETE = 25;

/** A shop left untouched because it holds real billing data. */
export interface SkippedShop {
    id: string;
    phone: number | null;
    shopName: string;
    counts: ShopDataCounts;
}

export interface BulkDeleteResult {
    deletedCount: number;
    deletedIds: string[];
    failedIds: string[];
    /** Held back pending an explicit allowShopsWithData opt-in. */
    skipped: SkippedShop[];
    /** JSON export written for each shop that was deleted. */
    exports: string[];
    exportDir: string;
}

/**
 * The name a dashboard should show for a shop.
 *
 * Returns "" for a shop that genuinely has not set one — the caller decides how
 * to present that, and an empty string is the honest answer. Nexus maps it to
 * null so the row reads "No shop name" rather than as a blank cell.
 */
const shopDisplayName = (phone: unknown, shopName: string | undefined): string => {
    if (Number(phone) === DEMO_ACCOUNT_PHONE) return DEMO_ACCOUNT_NAME;
    return shopName ?? "";
};

export const DukandarService = {
    async createDukandar(payload: CreateDukandarDTO): Promise<DukandarDocument> {
        const shopDetail = await ShopDetailService.createShopDetail(payload.shopDetails);

        const doc: Partial<IDukandar> = {
            phone: payload.phone,
            shopDetails: shopDetail._id,
            gst: {
                gstGold: payload.gst?.gstGold ?? 0,
                gstSilver: payload.gst?.gstSilver ?? 0,
                makingGSTRate: payload.gst?.makingGSTRate ?? 0,
            },
        };

        const dukandar = await Dukandar.create(doc);
        
        // Link shop to dukandar's id
        if (shopDetail) {
            await ShopDetailService.updateShopDetail(shopDetail._id.toString(), { userId: (dukandar._id as any).toString() });
        }
        
        return dukandar;
    },

    async getAllDukandars(): Promise<DukandarDocument[]> {
        return await Dukandar.find().populate("shopDetails");
    },

    async getDukandarById(id: string): Promise<DukandarDocument | null> {
        if (!Types.ObjectId.isValid(id)) return null;
        return await Dukandar.findById(id).populate("shopDetails");
    },

    async updateDukandar(
        id: string,
        payload: UpdateDukandarDTO
    ): Promise<DukandarDocument | null> {
        if (!Types.ObjectId.isValid(id)) return null;

        const existingDukandar = await Dukandar.findById(id);
        if (!existingDukandar) return null;

        const update: Record<string, unknown> = {};

        if (payload.phone !== undefined) {
            update.phone = payload.phone;
        }

        if (payload.shopDetails !== undefined) {
            await ShopDetailService.updateShopDetail(existingDukandar.shopDetails.toString(), payload.shopDetails);
        }

        if (payload.product !== undefined) {
            update.product = payload.product
                ? new Types.ObjectId(payload.product)
                : undefined;
        }

        if (payload.gst) {
            for (const [key, value] of Object.entries(payload.gst)) {
                update[`gst.${key}`] = value;
            }
        }

        return await Dukandar.findByIdAndUpdate(id, update, {
            new: true,
            runValidators: true,
        })
            .populate("shopDetails")
    },

    async deleteDukandar(id: string): Promise<{ deletedId: string } | null> {
        return await DukandarService.hardDeleteWithCascade(id, "manual");
    },

    /**
     * Deletion initiated by the account holder from inside the app.
     *
     * Identical cascade to an admin deletion — the only difference is that the
     * DeletedUserLog is tagged "self", so admin churn reporting can separate
     * shopkeepers who chose to leave from accounts an admin cleaned up.
     */
    async deleteOwnAccount(id: string): Promise<{ deletedId: string } | null> {
        return await DukandarService.hardDeleteWithCascade(id, "self");
    },

    async hardDeleteWithCascade(id: string, reason: "manual" | "bulk" | "self" = "manual"): Promise<{ deletedId: string } | null> {
        if (!Types.ObjectId.isValid(id)) return null;

        const dukandar = await Dukandar.findById(id).populate<{ shopDetails: { _id: Types.ObjectId; shopName?: string } }>("shopDetails").lean();
        if (!dukandar) return null;

        const phone = dukandar.phone;

        // Snapshot activity stats before anything is deleted.
        const [invoiceAgg, customersCount, contactCount] = await Promise.all([
            InvoiceModel.aggregate([
                { $match: { userId: dukandar._id } },
                { $group: { _id: null, totalInvoices: { $sum: 1 }, totalSalesValue: { $sum: "$totalAmount" } } },
            ]),
            CustomerModel.countDocuments({ dukandarId: id }),
            CommunicationService.getCount(dukandar._id as Types.ObjectId),
        ]);

        await DeletedUserLogModel.create({
            originalDukandarId: dukandar._id,
            phone,
            shopName: (dukandar.shopDetails as any)?.shopName ?? "",
            registrationDate: (dukandar as any).createdAt ?? null,
            deletedAt: new Date(),
            deletionReason: reason,
            totalInvoices: invoiceAgg[0]?.totalInvoices ?? 0,
            totalSalesValue: invoiceAgg[0]?.totalSalesValue ?? 0,
            customersCount,
            contactCount,
        });

        // Purge ImageKit files before removing the DB references to them.
        //
        // The whole folder, not three files by name. Everything this shop ever
        // uploaded lives under its storage key — branding, customer profile
        // photos, invoice item photos, and a declaration's ornament, ID-proof
        // and witness images. Naming three of them left all the rest on
        // ImageKit permanently, photographs of sellers' ID documents included,
        // long after the shop that collected them was gone.
        //
        // Both keys, because uploads address the shop by whichever it had at
        // the time: resolveStorageKey uses the shop profile's phone and falls
        // back to the userId when no profile exists yet, so a shop that
        // uploaded before completing its profile has files under both.
        const storageKeys = new Set<string>([String(phone), String(id)]);
        const shopPhone = (await ShopDetail.findOne({ userId: id }).lean())?.phone;
        if (shopPhone) storageKeys.add(String(shopPhone));

        await Promise.all([...storageKeys].map(key => deleteShopFolder(key)));

        const shopDetailsId = (dukandar.shopDetails as any)?._id;

        await Promise.all([
            shopDetailsId ? ShopDetailService.deleteShopDetail(String(shopDetailsId)) : Promise.resolve(null),
            CustomerService.deleteAllForDukandar(id),
            InvoiceModel.deleteMany({ userId: id }),
            OrderModel.deleteMany({ userId: id }),
            // Old-gold declarations. Missing here until 26 Aug 2026, and
            // CustomerService.deleteAllForDukandar does not reach them either —
            // it removes CustomerModel rows and nothing hanging off them. So a
            // deleted shop left its declarations behind, live, pointing at a
            // userId with no dukandar and orderIds with no bills. One such
            // record was still in production, and it is what made "shop ?"
            // appear in the audit of this collection.
            //
            // Hard, matching the invoices and orders above rather than the soft
            // delete used everywhere else for declarations: the whole shop is
            // going, and exportShopBeforeDelete has already written every one of
            // these to JSON — it counts them in hasRealData, so a shop holding
            // only declarations is correctly treated as a shop with real data.
            PurchaseOldGoldModel.deleteMany({ userId: id }),
            // Per-shop numbering sequences: customer_<id>, invoice_<id>,
            // purchaseOldGold_<id>. Left behind, they are rows that can never
            // be read again, and a phone re-registering as a new shop gets a
            // new ObjectId so it never collides with them either.
            //
            // Matched on the _<id> suffix on purpose. The order sequence is the
            // single global "orders" counter shared by every shop (see
            // ORDER_COUNTER_ID in order.service.ts) — deleting that would reset
            // ADV numbering for the entire platform and start handing out
            // numbers already in use.
            CounterModel.deleteMany({ id: { $regex: `_${id}$` } }),
            // The last four per-shop collections, none of which this cascade
            // reached until 26 Aug 2026. The catalogue was the costly one:
            // production held 104 catalogue products of which 100 belonged to
            // shops that no longer existed.
            //
            // Items are the per-dukandar ledger written when an invoice is
            // created. Deleting an invoice one at a time removes its rows
            // (see deleteInvoice), but deleting the whole account never did,
            // so wiping the invoices left the ledger of them behind.
            CatalogProductModel.deleteMany({ dukandarId: id }),
            PurchaseModel.deleteMany({ userId: id }),
            ItemModel.deleteMany({ dukandarId: id }),
            MetalRateModel.deleteMany({ dukandarId: id }),
            CommunicationService.deleteAllForDukandar(id),
            AppOpenLog.deleteMany({ dukandarId: id }),
        ]);

        await Dukandar.findByIdAndDelete(id);

        return { deletedId: id };
    },

    /**
     * Deletes several shops in one admin action, with three guards.
     *
     * On SoneBill, on 21 Aug 2026, this method removed 31 shops in 29 seconds
     * — 57 invoices, 70 customers, ~Rs 68 lakh of GST-relevant billing — in a
     * cleanup aimed at empty test accounts that silently swept up real ones.
     * None of it was recoverable. The same exposure exists here: a self-hosted
     * mongod has no point-in-time restore unless it is configured, and the
     * oplog only reaches back as far as its sizing allows. The guards below
     * each block one link in that chain.
     *
     *   1. A batch cap, so one runaway click cannot empty the platform.
     *   2. Shops holding real billing data are SKIPPED unless the caller opts
     *      in explicitly — this is the one that would have stopped 21 Aug,
     *      where the intent was only ever to remove empty signups.
     *   3. Every shop is exported to JSON before it is touched, and a failed
     *      export cancels that shop's delete rather than proceeding without it.
     *
     * Skipped shops are returned rather than thrown, so the dashboard can show
     * exactly which accounts hold real data and let the admin decide, instead
     * of failing the whole batch and inviting a blind retry with the override.
     */
    async bulkDeleteDukandars(
        ids: string[],
        options: { allowShopsWithData?: boolean } = {},
    ): Promise<BulkDeleteResult> {
        if (ids.length > MAX_BULK_DELETE) {
            throw new AppError(
                `Refusing to delete ${ids.length} shops in one request (limit ${MAX_BULK_DELETE}). Split it into smaller batches.`,
                { statusCode: 400, code: "VALIDATION_ERROR" },
            );
        }

        const deletedIds: string[] = [];
        const failedIds: string[] = [];
        const skipped: SkippedShop[] = [];
        const exports: string[] = [];

        for (const id of ids) {
            try {
                const counts = await countShopData(id);

                if (hasRealData(counts) && !options.allowShopsWithData) {
                    const shop = await Dukandar.findById(id)
                        .populate<{ shopDetails: { shopName?: string } }>("shopDetails")
                        .lean();
                    skipped.push({
                        id,
                        phone: shop?.phone ?? null,
                        shopName: shopDisplayName(
                            shop?.phone,
                            (shop?.shopDetails as { shopName?: string } | undefined)?.shopName,
                        ),
                        counts,
                    });
                    continue;
                }

                // Export first. A shop whose export failed is left alone: an
                // irreversible delete is the entire problem this guards, and
                // deleting without the safety net would defeat the point.
                const { file } = await exportShopBeforeDelete(id);
                exports.push(file);

                const result = await DukandarService.hardDeleteWithCascade(id, "bulk");
                if (result) {
                    deletedIds.push(id);
                } else {
                    failedIds.push(id);
                }
            } catch {
                failedIds.push(id);
            }
        }

        return {
            deletedCount: deletedIds.length,
            deletedIds,
            failedIds,
            skipped,
            exports,
            exportDir: EXPORT_DIR,
        };
    },

    async getDeletedUserLogs() {
        return DeletedUserLogModel.find().sort({ deletedAt: -1 }).lean();
    },

    async getCustomersByDukandarId(dukandarId: string) {
        return await CustomerService.getAllCustomers(dukandarId);
    },

    async recordAppOpen(
        dukandarId: string,
        deviceInfo?: DeviceInfo,
        location?: GeoLocation,
    ) {
        if (!Types.ObjectId.isValid(dukandarId)) return null;
        const id = new Types.ObjectId(dukandarId);
        const today = new Date().toISOString().slice(0, 10);

        const [openLog, dukandar] = await Promise.all([
            AppOpenLog.findOneAndUpdate(
                { dukandarId: id, date: today },
                { $inc: { count: 1 } },
                { upsert: true, new: true }
            ),
            Dukandar.findById(id).select("deviceInfo location"),
        ]);
        if (!dukandar) return null;

        if (deviceInfo) {
            const stored = dukandar.deviceInfo;
            // appVersion/buildNumber must be part of this comparison: an app update
            // is the one change that happens on an otherwise identical device, so
            // without them the stored version would stay at whatever was installed
            // on first login and the admin dashboard would report it forever.
            const changed =
                !stored ||
                stored.platform !== deviceInfo.platform ||
                stored.make !== deviceInfo.make ||
                stored.model !== deviceInfo.model ||
                stored.osVersion !== deviceInfo.osVersion ||
                stored.appVersion !== deviceInfo.appVersion ||
                stored.buildNumber !== deviceInfo.buildNumber;

            if (changed) {
                await Dukandar.findByIdAndUpdate(id, {
                    deviceInfo: { ...deviceInfo, updatedAt: new Date() },
                });
            }
        }

        // App open is the one event every shop produces repeatedly, which makes
        // it the only place a shop that registered before location existed ever
        // gets one. Written on every open rather than only when it changes:
        // unlike deviceInfo this is a merge of whatever resolved, so there is
        // nothing to compare against that would not itself need the write.
        const merged = location ? mergeLocation(dukandar.location, location) : null;
        if (merged) {
            await Dukandar.findByIdAndUpdate(id, { location: merged });
        }

        return { openCount: openLog.count };
    },

    /**
     * Every shop with its usage and sales summary.
     *
     * `includeAdmins` appends the platform's own admin accounts. It is opt-in and
     * defaults to off because this endpoint also backs Gold Khata Book's admin dashboard,
     * where an admin appearing among the shops would corrupt the shop count and
     * every list built from it. Nexus asks for them because an admin who logs into
     * the app produces engagement rows keyed by the admin's ObjectId, and without
     * this those rows can never resolve to a name.
     */
    async getAllDukandarsWithStats(includeAdmins = false) {
        const dukandars = await Dukandar.find().populate<{ shopDetails: { shopName?: string } }>("shopDetails").lean();
        const today = new Date().toISOString().slice(0, 10);
        const todaysOpenLogs = await AppOpenLog.find({ date: today }).lean();
        const openCountByDukandarId = new Map(
            todaysOpenLogs.map((log) => [log.dukandarId.toString(), log.count])
        );

        const stats = await Promise.all(dukandars.map(async (d) => {
            const id = d._id as Types.ObjectId;

            const [invoiceAgg, orderAgg, customersCount, contactCount] = await Promise.all([
                InvoiceModel.aggregate([
                    { $match: { userId: id } },
                    { $group: { _id: null, totalInvoices: { $sum: 1 }, totalSalesValue: { $sum: "$totalAmount" } } },
                ]),
                OrderModel.aggregate([
                    { $match: { userId: id } },
                    { $group: { _id: "$status", count: { $sum: 1 } } },
                ]),
                CustomerModel.countDocuments({ dukandarId: id }),
                CommunicationService.getCount(id),
            ]);

            const totalInvoices: number = invoiceAgg[0]?.totalInvoices ?? 0;
            const totalSalesValue: number = invoiceAgg[0]?.totalSalesValue ?? 0;
            const pendingOrdersCount: number = orderAgg.find((g: any) => g._id === 'pending')?.count ?? 0;
            const completedOrdersCount: number = orderAgg.find((g: any) => g._id === 'completed')?.count ?? 0;

            // Last activity: latest invoice or order createdAt
            const [lastInvoice, lastOrder] = await Promise.all([
                InvoiceModel.findOne({ userId: id }).sort({ createdAt: -1 }).select('createdAt').lean(),
                OrderModel.findOne({ userId: id }).sort({ createdAt: -1 }).select('createdAt').lean(),
            ]);
            const dates = [lastInvoice?.createdAt, lastOrder?.createdAt].filter(Boolean) as Date[];
            const lastActivity = dates.length ? new Date(Math.max(...dates.map(dt => dt.getTime()))) : null;

            return {
                _id: id,
                phone: d.phone,
                shopName: shopDisplayName(d.phone, (d.shopDetails as any)?.shopName),
                role: "dukandar" as const,
                totalInvoices,
                totalSalesValue,
                customersCount,
                advanceOrdersCount: pendingOrdersCount + completedOrdersCount,
                pendingOrdersCount,
                registrationDate: (d as any).createdAt ?? null,
                lastActivity,
                contactCount,
                deviceInfo: (d as any).deviceInfo ?? null,
                appOpensToday: openCountByDukandarId.get(id.toString()) ?? 0,
                // Flattened out of the stored subdocument because Nexus reads
                // city/region/country from the top level of each row. Nesting
                // them here would enrich nothing and fail silently, since
                // enrichment is best-effort and never reports a missing field.
                city: d.location?.city ?? null,
                region: d.location?.region ?? null,
                country: d.location?.country ?? null,
            };
        }));

        if (!includeAdmins) return stats;

        // Same row shape as a shop, with the business counters zeroed: an admin
        // has no invoices or customers of their own, and inventing numbers here
        // would put them into any "top shops" ordering built on this payload.
        const admins = await Admin.find().lean();
        const adminRows = admins.map((a) => ({
            _id: a._id as Types.ObjectId,
            phone: a.phone,
            shopName: a.name || ADMIN_FALLBACK_NAME,
            role: "admin" as const,
            totalInvoices: 0,
            totalSalesValue: 0,
            customersCount: 0,
            advanceOrdersCount: 0,
            pendingOrdersCount: 0,
            registrationDate: (a as any).createdAt ?? null,
            lastActivity: null,
            contactCount: 0,
            deviceInfo: null,
            appOpensToday: 0,
            // Admins are staff, not shops: they are here only so engagement rows
            // keyed by an admin's id can resolve to a name, and where they sign
            // in from is not something this platform has a reason to record.
            city: null,
            region: null,
            country: null,
        }));

        return [...stats, ...adminRows];
    },

    async getAdminAnalytics() {
        const now = new Date();
        const startOf30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfWeek = new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000);
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const [
            dailyRegistrationsRaw,
            lastRegistered,
            dailyInvoicesRaw,
            invoicesToday,
            invoicesThisWeek,
            invoicesThisMonth,
            dukandars,
            deviceByPlatformRaw,
            deviceByModelRaw,
        ] = await Promise.all([
            // Daily registrations for last 30 days
            Dukandar.aggregate([
                { $match: { createdAt: { $gte: startOf30Days } } },
                { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
                { $sort: { _id: 1 } },
            ]),
            // Last registered user
            Dukandar.findOne().sort({ createdAt: -1 }).select('createdAt phone shopDetails').populate<{ shopDetails: { shopName?: string } }>('shopDetails').lean(),
            // Daily invoices (platform-wide) for last 30 days
            InvoiceModel.aggregate([
                { $match: { createdAt: { $gte: startOf30Days }, deletedAt: null } },
                { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
                { $sort: { _id: 1 } },
            ]),
            // Invoices today
            InvoiceModel.countDocuments({ createdAt: { $gte: startOfToday }, deletedAt: null }),
            // Invoices this week
            InvoiceModel.countDocuments({ createdAt: { $gte: startOfWeek }, deletedAt: null }),
            // Invoices this month
            InvoiceModel.countDocuments({ createdAt: { $gte: startOfMonth }, deletedAt: null }),
            // All users with last activity (for churn computation)
            Dukandar.find().populate<{ shopDetails: { shopName?: string } }>('shopDetails').lean(),
            // Device platform breakdown (android/ios/web/unknown)
            Dukandar.aggregate([
                { $group: { _id: { $ifNull: ['$deviceInfo.platform', 'unknown'] }, count: { $sum: 1 } } },
            ]),
            // Top device makes/models (only where known)
            Dukandar.aggregate([
                { $match: { 'deviceInfo.make': { $exists: true, $ne: null } } },
                { $group: { _id: { make: '$deviceInfo.make', model: '$deviceInfo.model' }, count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 },
            ]),
        ]);

        // Compute per-user last activity in parallel
        const userActivity = await Promise.all(dukandars.map(async (d) => {
            const id = d._id as Types.ObjectId;
            const [lastInvoice, lastOrder] = await Promise.all([
                InvoiceModel.findOne({ userId: id }).sort({ createdAt: -1 }).select('createdAt').lean(),
                OrderModel.findOne({ userId: id }).sort({ createdAt: -1 }).select('createdAt').lean(),
            ]);
            const dates = [lastInvoice?.createdAt, lastOrder?.createdAt].filter(Boolean) as Date[];
            const lastActivity = dates.length ? new Date(Math.max(...dates.map(dt => dt.getTime()))) : null;
            return {
                id,
                phone: d.phone,
                shopName: (d.shopDetails as any)?.shopName ?? '',
                registrationDate: (d as any).createdAt,
                lastActivity,
                deviceInfo: (d as any).deviceInfo ?? null,
            };
        }));

        /**
         * An account exists from the moment an OTP is verified, before a shop
         * name has ever been asked for (see auth.controller.ts). Someone who
         * closes the app on the registration screen therefore leaves a real
         * Dukandar row behind with nothing in it.
         *
         * Those are not shops, and counting them as such quietly corrupts every
         * other figure here — they were landing in `churnedUsers` and
         * `neverActiveCount`, so "churned" included people who never finished
         * signing up and could not have churned from anything.
         *
         * The test is BOTH conditions. No shop name alone is not enough: the
         * registration screen can now be skipped, so a shopkeeper can be billing
         * daily with the name still unset. Those are real shops with a nagging
         * to-do, and they stay in the shop counts.
         */
        const isAbandonedSignup = (u: { shopName: string; lastActivity: Date | null }) =>
            !u.shopName?.trim() && !u.lastActivity;

        const shops = userActivity.filter(u => !isAbandonedSignup(u));

        const pendingRegistrations = userActivity
            .filter(isAbandonedSignup)
            .map(u => ({
                _id: String(u.id),
                phone: u.phone,
                registrationDate: u.registrationDate ? u.registrationDate.toISOString() : null,
                // The lead-gen team's opening question is "what put you off?",
                // and the device is often the answer (a low-end handset, a
                // cramped screen), so it travels with the row.
                deviceInfo: u.deviceInfo,
                daysSinceRegistered: u.registrationDate
                    ? Math.floor((now.getTime() - new Date(u.registrationDate).getTime()) / (24 * 60 * 60 * 1000))
                    : null,
            }))
            .sort((a, b) => (b.registrationDate ?? '').localeCompare(a.registrationDate ?? ''));

        const churnThreshold = startOf30Days;
        const churnedUsers = shops
            .filter(u => !u.lastActivity || u.lastActivity < churnThreshold)
            .map(u => ({
                _id: String(u.id),
                phone: u.phone,
                shopName: u.shopName,
                lastActivity: u.lastActivity ? u.lastActivity.toISOString() : null,
                registrationDate: u.registrationDate ? u.registrationDate.toISOString() : null,
                daysSinceActivity: u.lastActivity
                    ? Math.floor((now.getTime() - u.lastActivity.getTime()) / (24 * 60 * 60 * 1000))
                    : null,
            }));

        const activeUsersLast30Days = shops.filter(u => u.lastActivity && u.lastActivity >= churnThreshold).length;
        const neverActiveCount = shops.filter(u => !u.lastActivity).length;

        // Counted off `shops` rather than a countDocuments over every Dukandar,
        // so "new this week" means new shops and cannot disagree with the list
        // behind it on the dashboard.
        const inRange = (u: { registrationDate: Date }, from: Date) =>
            !!u.registrationDate && new Date(u.registrationDate).getTime() >= from.getTime();
        const newUsersThisWeek = shops.filter(u => inRange(u as any, startOfWeek)).length;
        const newUsersThisMonth = shops.filter(u => inRange(u as any, startOfMonth)).length;

        return {
            dailyRegistrations: dailyRegistrationsRaw.map((r: any) => ({ date: r._id, count: r.count })),
            lastRegisteredAt: (lastRegistered as any)?.createdAt?.toISOString() ?? null,
            lastRegisteredUser: lastRegistered ? { phone: lastRegistered.phone, shopName: (lastRegistered.shopDetails as any)?.shopName ?? '' } : null,
            newUsersThisWeek,
            newUsersThisMonth,
            dailyInvoices: dailyInvoicesRaw.map((r: any) => ({ date: r._id, count: r.count })),
            invoicesToday,
            invoicesThisWeek,
            invoicesThisMonth,
            churnedUsers,
            activeUsersLast30Days,
            neverActiveCount,
            // Shops that finished (or skipped past) registration. Reported
            // alongside the abandoned signups rather than instead of them: the
            // drop-off rate at registration is the number that says whether the
            // form is the problem, and hiding it hides the problem.
            shopCount: shops.length,
            pendingRegistrations,
            devicesByPlatform: deviceByPlatformRaw.map((r: any) => ({ platform: r._id, count: r.count })),
            topDeviceModels: deviceByModelRaw.map((r: any) => ({ make: r._id.make, model: r._id.model ?? 'Unknown', count: r.count })),
        };
    },

    async getDukandarStats(dukandarId: string) {
        if (!Types.ObjectId.isValid(dukandarId)) return null;
        const id = new Types.ObjectId(dukandarId);

        const dukandar = await Dukandar.findById(id).populate<{ shopDetails: { shopName?: string } }>("shopDetails").lean();
        if (!dukandar) return null;

        const today = new Date().toISOString().slice(0, 10);
        const [invoiceAgg, orderAgg, customersCount, todaysOpenLog] = await Promise.all([
            InvoiceModel.aggregate([
                { $match: { userId: id } },
                { $group: { _id: null, totalInvoices: { $sum: 1 }, totalSalesValue: { $sum: "$totalAmount" } } },
            ]),
            OrderModel.aggregate([
                { $match: { userId: id } },
                { $group: { _id: "$status", count: { $sum: 1 } } },
            ]),
            CustomerModel.countDocuments({ dukandarId: id }),
            AppOpenLog.findOne({ dukandarId: id, date: today }).lean(),
        ]);

        const totalInvoices: number = invoiceAgg[0]?.totalInvoices ?? 0;
        const totalSalesValue: number = invoiceAgg[0]?.totalSalesValue ?? 0;
        const pendingOrdersCount: number = orderAgg.find((g: any) => g._id === 'pending')?.count ?? 0;
        const completedOrdersCount: number = orderAgg.find((g: any) => g._id === 'completed')?.count ?? 0;

        const [lastInvoice, lastOrder] = await Promise.all([
            InvoiceModel.findOne({ userId: id }).sort({ createdAt: -1 }).select('createdAt').lean(),
            OrderModel.findOne({ userId: id }).sort({ createdAt: -1 }).select('createdAt').lean(),
        ]);
        const dates = [lastInvoice?.createdAt, lastOrder?.createdAt].filter(Boolean) as Date[];
        const lastActivity = dates.length ? new Date(Math.max(...dates.map(dt => dt.getTime()))) : null;

        return {
            _id: id,
            phone: dukandar.phone,
            shopName: (dukandar.shopDetails as any)?.shopName ?? '',
            totalInvoices,
            totalSalesValue,
            customersCount,
            advanceOrdersCount: pendingOrdersCount + completedOrdersCount,
            pendingOrdersCount,
            completedOrdersCount,
            registrationDate: (dukandar as any).createdAt ?? null,
            lastActivity,
            appOpensToday: todaysOpenLog?.count ?? 0,
        };
    },
};

