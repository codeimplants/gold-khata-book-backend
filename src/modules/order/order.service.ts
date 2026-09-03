import { Types } from "mongoose";
import {
    OrderModel,
    WEIGHT_SETTLED_EPSILON_GM,
    RATE_EPSILON,
    weightedItemRate,
} from "./order.model";
import type {
    CreateOrderDTO,
    AddPaymentDTO,
    UpdateOrderDTO,
    AdvancePayment,
} from "./order.types";
import { CreateInvoiceDTO } from "../invoice/invoice.types";
import { AppError } from "../../common/errors/AppError";
import { InvoiceService } from "../invoice/invoice.service";
import { InvoiceModel } from "../invoice/invoice.model";
import { retireDeclarationFor } from "../../common/utils/declarationLifecycle";
import { ShopDetail } from "../shopDetail/shopDetails.model";
import { uploadOrnamentPhoto, deleteImageByFileId } from "../../common/utils/imageKit";
import { deletePhotoIfUnreferenced, collectPhotoFileIds, releasePhotos } from "../../common/utils/photoReferences";

/** Mirrors MAX_DECLARATION_PHOTOS — the same ornaments, the same limit. */
const MAX_ORNAMENT_PHOTOS = 6;
/** Per item, not per order — matches InvoiceService.MAX_ITEM_PHOTOS. */
const MAX_ITEM_PHOTOS = 4;
import mongoose from "mongoose";
import { getNextSequence } from "../../common/utils/counter.util";
import { CounterModel } from "../../common/models/Counter.model";

const ORDER_COUNTER_ID = "orders";
let orderSequenceSyncPromise: Promise<void> | null = null;

const ensureOrderCounterSynced = async () => {
    if (orderSequenceSyncPromise) {
        return orderSequenceSyncPromise;
    }

    const pipeline = [
        {
            $match: {
                orderNumber: { $regex: "^ADV-\\d+" },
            },
        },
        {
            $project: {
                numberParts: { $split: ["$orderNumber", "-"] },
            },
        },
        {
            $project: {
                numericPart: {
                    $toInt: { $arrayElemAt: ["$numberParts", 1] },
                },
            },
        },
        {
            $group: {
                _id: null,
                max: { $max: "$numericPart" },
            },
        },
    ];

    orderSequenceSyncPromise = (async () => {
        const [result] = await OrderModel.aggregate(pipeline);
        const highestSequence = Number(result?.max || 0);

        await CounterModel.findOneAndUpdate(
            { id: ORDER_COUNTER_ID },
            { $max: { seq: highestSequence } },
            { upsert: true }
        );
    })();

    try {
        await orderSequenceSyncPromise;
    } catch (error) {
        orderSequenceSyncPromise = null;
        throw error;
    }
};

export const OrderService = {
    /**
     * Generate unique order number
     */
    async generateOrderNumber(userId: string): Promise<string> {
        await ensureOrderCounterSynced();
        const sequence = await getNextSequence(ORDER_COUNTER_ID);
        const newNumber = `ADV-${sequence}`;
        console.log(`[OrderService] Generated order number: ${newNumber} (user=${userId})`);
        return newNumber;
    },

    /**
     * Create a new order
     */
    async createOrder(
        userId: string,
        customerId: string,
        payload: CreateOrderDTO,
        dukandarId?: string
    ) {

        // Generate order number
        const orderNumber = await this.generateOrderNumber(userId);

        // Calculate initial payment details
        let payments: AdvancePayment[] = [];
        let totalPaid = 0;
        let weightPaid = 0;

        if (payload.paymentMode === "advance" && payload.initialPayment && payload.initialPayment.amount > 0) {
            const { amount, goldRate, notes } = payload.initialPayment;
            const weightCovered = goldRate > 0 ? (amount / goldRate) : 0;

            payments.push({
                date: payload.orderDate || new Date(),
                amount,
                goldRate,
                weightCovered,
                paymentType: "advance",
                notes: notes || "Initial advance payment",
            });

            totalPaid = amount;
            weightPaid = weightCovered;
        }

        const totalWeight = payload.items.reduce((sum, item) => sum + item.weight, 0);
        const remainingWeight = totalWeight - weightPaid;
        const initialGoldRate = payload.initialPayment?.goldRate || payload.bookingRate || 0;

        // Advance orders always start as pending
        const status = "pending" as const;

        const order = new OrderModel({
            userId: new Types.ObjectId(userId),
            customerId: new Types.ObjectId(customerId),
            dukandarId: dukandarId ? new Types.ObjectId(dukandarId) : undefined,
            orderNumber,
            orderDate: payload.orderDate || new Date(),
            items: payload.items,
            totalWeight,
            paymentMode: "advance",
            payments,
            totalPaid,
            weightPaid,
            remainingWeight,
            bookingRate: initialGoldRate,
            includeGST: payload.includeGST ?? true,
            isOrnamentExchanges: payload.isOrnamentExchanges ?? false,
            ornamentExchanges: payload.isOrnamentExchanges ? payload.ornamentExchanges : undefined,
            gstRate: payload.gstRate ?? 3,
            includeItemPhotosOnBill: payload.includeItemPhotosOnBill ?? false,
            status,
        });
        // estimatedBalance/amount/subTotal/gstAmount are computed in the
        // pre-save hook (order.model.ts) from items + exchange + GST, and
        // recomputed on every subsequent save (e.g. addPayment).

        await order.save();
        return order.populate("customerId");
    },

    /**
     * Get all orders for a user
     */
    async getAllOrders(
        userId: string,
        customerId?: string,
        status?: string,
        dukandarId?: string
    ) {
        const query: any = { userId: new Types.ObjectId(userId), deletedAt: null };

        if (customerId) {
            query.customerId = new Types.ObjectId(customerId);
        }

        if (status) {
            query.status = status;
        }

        if (dukandarId) {
            query.dukandarId = new Types.ObjectId(dukandarId);
        }

        const orders = await OrderModel.find(query)
            .populate("customerId")
            .sort({ createdAt: -1 });

        return orders;
    },

    /**
     * Get order by ID
     */
    async getOrderById(userId: string, orderId: string, dukandarId?: string) {
        const query: any = {
            _id: new Types.ObjectId(orderId),
            userId: new Types.ObjectId(userId),
        };

        if (dukandarId) {
            query.dukandarId = new Types.ObjectId(dukandarId);
        }

        const order = await OrderModel.findOne(query).populate("customerId");

        if (!order) {
            throw new AppError("Order not found", { statusCode: 404, code: "NOT_FOUND" });
        }

        return order;
    },

    /**
     * Add payment to an order
     */
    async addPayment(
        userId: string,
        orderId: string,
        payload: AddPaymentDTO,
        dukandarId?: string
    ) {
        const order = await this.getOrderById(userId, orderId, dukandarId);

        if (order.status !== "pending") {
            throw new AppError("Cannot add payment to a non-pending order", { statusCode: 400, code: "BAD_REQUEST" });
        }

        console.log('[OrderService] addPayment payload:', JSON.stringify(payload, null, 2));

        const weightCovered = payload.goldRate > 0 ? (payload.amount / payload.goldRate) : 0;

        // Add new payment
        order.payments.push({
            date: payload.date || new Date(),
            amount: payload.amount || 0,
            goldRate: payload.goldRate || 0,
            weightCovered,
            paymentType: payload.paymentType || "advance",
            notes: payload.notes,
        });

        // Recalculate totals (pre-save hook will handle this)
        await order.save();

        // Check if order is fully paid. Compared with a tolerance because
        // weightPaid is no longer rounded to 3dp — see WEIGHT_SETTLED_EPSILON_GM.
        if (order.totalWeight - order.weightPaid < WEIGHT_SETTLED_EPSILON_GM) {
            order.status = "completed";
            order.completedAt = new Date();
            await order.save();
        }

        return order.populate("customerId");
    },

    /**
     * Get payment history for an order
     */
    async getPaymentHistory(
        userId: string,
        orderId: string,
        dukandarId?: string
    ) {
        const order = await this.getOrderById(userId, orderId, dukandarId);
        return order.payments;
    },

    /**
     * Update an existing payment within an order
     */
    async updatePayment(
        userId: string,
        orderId: string,
        paymentId: string,
        payload: AddPaymentDTO,
        dukandarId?: string
    ) {
        const order = await this.getOrderById(userId, orderId, dukandarId);

        if (order.status !== "pending") {
            throw new AppError("Cannot update payment of a non-pending order", {
                statusCode: 400,
                code: "BAD_REQUEST",
            });
        }

        const payment = order.payments.id(paymentId);
        if (!payment) {
            throw new AppError("Payment not found", {
                statusCode: 404,
                code: "NOT_FOUND",
            });
        }

        // Update payment fields
        if (payload.amount !== undefined) payment.amount = payload.amount;
        if (payload.goldRate !== undefined) payment.goldRate = payload.goldRate;
        if (payload.date !== undefined) payment.date = new Date(payload.date);
        if (payload.notes !== undefined) payment.notes = payload.notes;

        // Recalculate weight covered if amount or rate changed
        if (payload.amount !== undefined || payload.goldRate !== undefined) {
            payment.weightCovered =
                payment.goldRate > 0 ? payment.amount / payment.goldRate : 0;
        }

        await order.save();
        return order.populate("customerId");
    },

    /**
     * Delete a payment from an order
     */
    async deletePayment(
        userId: string,
        orderId: string,
        paymentId: string,
        dukandarId?: string
    ) {
        const order = await this.getOrderById(userId, orderId, dukandarId);

        if (order.status !== "pending") {
            throw new AppError("Cannot delete payment from a non-pending order", {
                statusCode: 400,
                code: "BAD_REQUEST",
            });
        }

        const payment = order.payments.id(paymentId);
        if (!payment) {
            throw new AppError("Payment not found", {
                statusCode: 404,
                code: "NOT_FOUND",
            });
        }

        // Remove the payment
        (order.payments as any).pull({ _id: paymentId });

        await order.save();

        // If weightPaid was updated (handled by pre-save), check if we need to update status
        // (though we already checked order.status !== "pending", maybe it was completed before?)
        // If it was completed, it wouldn't have reached here. 
        // But if someone manually sets status to completed and weightPaid < totalWeight, 
        // the status should stay/become pending.

        return order.populate("customerId");
    },

    /**
     * Update order
     */
    async updateOrder(
        userId: string,
        orderId: string,
        payload: UpdateOrderDTO,
        dukandarId?: string
    ) {
        const order = await this.getOrderById(userId, orderId, dukandarId);
        console.log(`[OrderService] updateOrder: currentStatus=${order.status}, payloadStatus=${payload.status}`);

        if (order.deletedAt) {
            throw new AppError("Cannot edit a deleted order", { statusCode: 400, code: "VALIDATION_ERROR" });
        }

        if (order.status === "completed" && payload.status !== "completed") {
            throw new AppError("Cannot update a completed order", { statusCode: 400, code: "BAD_REQUEST" });
        }

        // Update allowed fields
        if (payload.items !== undefined) {
            // Captured before the swap so an edit that changes the rate can be
            // told apart from one that only touches weights, names or charges.
            const previousRate = weightedItemRate(order.items, order.bookingRate);

            // Item photos are uploaded separately and live on the item, so a
            // resent item list would drop them — the shopkeeper's photos would
            // vanish on an unrelated price fix. Carried across by position, the
            // same handle the upload route uses; photos sent with the item win.
            const previousItems = (order.items || []) as any[];
            order.items = (payload.items as any[]).map((item: any, index: number) => {
                if (item.photos !== undefined) return item;
                const previous = previousItems[index];
                return previous?.photos?.length ? { ...item, photos: previous.photos } : item;
            });

            const nextRate = weightedItemRate(order.items, order.bookingRate);
            const rateChanged =
                nextRate > 0 && Math.abs(nextRate - previousRate) > RATE_EPSILON;

            if (rateChanged) {
                // The order screen prices the outstanding weight at bookingRate
                // while the printed bill prices it at the item rate. Leaving
                // bookingRate behind is exactly what made an edited order keep
                // showing the old total on screen while print showed the new one.
                order.bookingRate = nextRate;

                // Correcting a mistyped rate should also correct the advance
                // that was derived from it — but only that one. A payment whose
                // rate no longer matches the order's previous rate was either
                // taken on a different day or typed by hand, and the customer is
                // holding a printed receipt for it. Rewriting that would falsify
                // history, so it keeps the rate it was actually taken at and
                // only the unpaid remainder moves to the new rate.
                const initialPayment = [...((order.payments as any) || [])].sort(
                    (a: any, b: any) =>
                        new Date(a.date).getTime() - new Date(b.date).getTime(),
                )[0] as any;

                if (
                    initialPayment &&
                    Math.abs(Number(initialPayment.goldRate) - previousRate) <=
                    RATE_EPSILON
                ) {
                    initialPayment.goldRate = nextRate;
                    initialPayment.weightCovered =
                        nextRate > 0 ? initialPayment.amount / nextRate : 0;
                }
            }

            // totalWeight, weightPaid, remainingWeight, estimatedBalance and the
            // making charges are all derived by the pre-save hook. Assigning them
            // here as well is how they drifted before: this block used to
            // recompute remainingWeight against a weightPaid the hook had not
            // refreshed yet, so the stored value disagreed with its own inputs.
        }

        if (payload.status !== undefined && payload.status !== order.status) {
            order.status = payload.status;
            if (payload.status === "completed") {
                order.completedAt = new Date();
            }
        }

        await order.save();
        return order.populate("customerId");
    },

    /**
     * Complete order and link to invoice
     */
    async completeOrder(
        userId: string,
        orderId: string,
        invoiceId: string,
        dukandarId?: string
    ) {
        const order = await this.getOrderById(userId, orderId, dukandarId);

        if (order.status === "completed") {
            throw new AppError("Order is already completed", { statusCode: 400, code: "BAD_REQUEST" });
        }

        order.status = "completed";
        order.finalInvoiceId = new Types.ObjectId(invoiceId);
        order.completedAt = new Date();

        await order.save();
        return order.populate("customerId");
    },

    /**
     * Cancel order
     */
    async cancelOrder(userId: string, orderId: string, dukandarId?: string) {
        const order = await this.getOrderById(userId, orderId, dukandarId);

        if (order.status === "completed") {
            throw new AppError("Cannot cancel a completed order", { statusCode: 400, code: "BAD_REQUEST" });
        }

        order.status = "cancelled";
        await order.save();

        return order.populate("customerId");
    },

    /**
     * Delete order
     */
    async deleteOrder(userId: string, orderId: string, dukandarId?: string) {
        const query: any = {
            _id: new Types.ObjectId(orderId),
            userId: new Types.ObjectId(userId),
        };

        if (dukandarId) {
            query.dukandarId = new Types.ObjectId(dukandarId);
        }

        const order = await OrderModel.findOne(query);

        if (!order) {
            throw new AppError("Order not found", { statusCode: 404, code: "NOT_FOUND" });
        }

        // Same reasoning as deleteInvoice: retire the attached declaration
        // rather than leave it live and unreachable. See declarationLifecycle.
        const fileIds = collectPhotoFileIds(order.toObject ? order.toObject() : order);

        await retireDeclarationFor(userId, order._id);
        await OrderModel.deleteOne({ _id: order._id });

        // After the row, never before — see deleteInvoice.
        await releasePhotos(userId, fileIds);
    },

    async trashOrder(userId: string, orderId: string, dukandarId?: string) {
        if (!Types.ObjectId.isValid(orderId)) {
            throw new AppError("Invalid order ID", { statusCode: 400, code: "VALIDATION_ERROR" });
        }
        const query: any = { _id: new Types.ObjectId(orderId), userId: new Types.ObjectId(userId) };
        if (dukandarId) query.dukandarId = new Types.ObjectId(dukandarId);
        const order = await OrderModel.findOneAndUpdate(query, { deletedAt: new Date() }, { new: true });
        if (!order) {
            throw new AppError("Order not found", { statusCode: 404, code: "NOT_FOUND" });
        }
        return order;
    },

    async restoreOrder(userId: string, orderId: string, dukandarId?: string) {
        if (!Types.ObjectId.isValid(orderId)) {
            throw new AppError("Invalid order ID", { statusCode: 400, code: "VALIDATION_ERROR" });
        }
        const query: any = { _id: new Types.ObjectId(orderId), userId: new Types.ObjectId(userId) };
        if (dukandarId) query.dukandarId = new Types.ObjectId(dukandarId);
        const order = await OrderModel.findOneAndUpdate(query, { deletedAt: null }, { new: true });
        if (!order) {
            throw new AppError("Order not found", { statusCode: 404, code: "NOT_FOUND" });
        }
        return order;
    },

    /**
     * Attaches photos of the old ornaments taken in against an order.
     *
     * Reuses uploadOrnamentPhoto (unique filenames, 1024px) rather than
     * uploadImage, which pins one filename per category and would make each
     * photo overwrite the last.
     */
    async addOrnamentPhotos(userId: string, orderId: string, files: any[]) {
        if (!Types.ObjectId.isValid(orderId)) return null;

        const order = await OrderModel.findOne({
            _id: new Types.ObjectId(orderId),
            userId: new Types.ObjectId(userId),
            deletedAt: null,
        });
        if (!order) return null;

        const existing = order.ornamentPhotos || [];
        const remaining = MAX_ORNAMENT_PHOTOS - existing.length;
        if (remaining <= 0) {
            throw new AppError(
                `An order can hold at most ${MAX_ORNAMENT_PHOTOS} ornament photos`,
                { statusCode: 400, code: "BAD_REQUEST" }
            );
        }

        const shop = await ShopDetail.findOne({ userId }).lean();
        const storageKey = shop?.phone ? String(shop.phone) : userId;

        const uploaded: { url: string; fileId: string }[] = [];
        for (const file of files.slice(0, remaining)) {
            const result = await uploadOrnamentPhoto(
                file,
                storageKey,
                "orders",
                order.orderNumber || String(order._id)
            );
            uploaded.push({ url: result.url, fileId: result.fileId });
        }

        // Atomic for the same reason as addItemPhotos below: this and the item
        // upload race, and whichever wrote second used to lose its photos to a
        // version conflict.
        const updated = await OrderModel.findOneAndUpdate(
            { _id: order._id, userId: new Types.ObjectId(userId), deletedAt: null },
            { $set: { ornamentPhotos: [...existing, ...uploaded] } },
            { new: true },
        );
        return updated;
    },

    /**
     * Drops one ornament photo from an order.
     *
     * Mirrors PurchaseOldGoldService.removePhoto, including the best-effort
     * remote cleanup: `deleteImageByFileId` swallows its own failures because
     * the database reference is what the shopkeeper actually sees, and an
     * orphaned file in ImageKit is invisible to them.
     */
    async removeOrnamentPhoto(userId: string, orderId: string, fileId: string) {
        if (!Types.ObjectId.isValid(orderId)) return null;

        const order = await OrderModel.findOne({
            _id: new Types.ObjectId(orderId),
            userId: new Types.ObjectId(userId),
            deletedAt: null,
        });
        if (!order) return null;

        const before = (order.ornamentPhotos || []).length;
        order.ornamentPhotos = (order.ornamentPhotos || []).filter(
            (p: any) => p.fileId !== fileId
        ) as any;
        if ((order.ornamentPhotos || []).length === before) {
            throw new AppError("Photo not found", {
                statusCode: 404,
                code: "NOT_FOUND",
            });
        }

        await order.save();
        await deletePhotoIfUnreferenced(userId, fileId);
        return order;
    },

    /**
     * Photos of one item on this order, addressed by the item's index — order
     * items carry `_id: false`, so the index is the only stable handle, and it
     * is the order the client sent. Mirrors InvoiceService.addItemPhotos.
     *
     * An out-of-range index is a 400 rather than a silent no-op: it means the
     * client and the stored order disagree about the item list, and quietly
     * dropping the upload would lose the shopkeeper's photo.
     */
    async addItemPhotos(userId: string, orderId: string, itemIndex: number, files: any[]) {
        if (!Types.ObjectId.isValid(orderId)) return null;

        const order = await OrderModel.findOne({
            _id: new Types.ObjectId(orderId),
            userId: new Types.ObjectId(userId),
            deletedAt: null,
        });
        if (!order) return null;

        const item = (order.items || [])[itemIndex] as any;
        if (!Number.isInteger(itemIndex) || itemIndex < 0 || !item) {
            throw new AppError("Item not found on this order", {
                statusCode: 400,
                code: "BAD_REQUEST",
            });
        }

        const existing = item.photos || [];
        const remaining = MAX_ITEM_PHOTOS - existing.length;
        if (remaining <= 0) {
            throw new AppError(`An item can hold at most ${MAX_ITEM_PHOTOS} photos`, {
                statusCode: 400,
                code: "BAD_REQUEST",
            });
        }

        const shop = await ShopDetail.findOne({ userId }).lean();
        const storageKey = shop?.phone ? String(shop.phone) : userId;

        const uploaded: { url: string; fileId: string }[] = [];
        for (const file of files.slice(0, remaining)) {
            const result = await uploadOrnamentPhoto(
                file,
                storageKey,
                "orders",
                order.orderNumber || String(order._id),
                `items/${itemIndex}`
            );
            uploaded.push({ url: result.url, fileId: result.fileId });
        }

        // Atomic $set, not doc.save(). save() on a modified array carries
        // Mongoose optimistic concurrency (match on __v, then bump it), and
        // the ornament and item uploads run concurrently by design - each
        // spending seconds in ImageKit before writing. Both loaded at the same
        // __v, the first commit bumped it, and the second died with "No
        // matching document found ... version 0". Silent, because the client
        // dispatches these fire-and-forget and never reads the failed indices.
        // Observed on a real advance order on 2026-08-23.
        const updated = await OrderModel.findOneAndUpdate(
            { _id: order._id, userId: new Types.ObjectId(userId), deletedAt: null },
            { $set: { [`items.${itemIndex}.photos`]: [...existing, ...uploaded] } },
            { new: true },
        );
        return updated;
    },

/**
     * Photos of ONE ornament taken in on this orders.
     *
     * Distinct from ornamentPhotos, which is a single set for the exchange as
     * a whole - how every exchange was recorded before this existed. Those stay
     * where they are and keep displaying; new photos are attached to the gold or
     * silver row they are actually of, which is the only question a photo of an
     * ornament exists to answer.
     *
     * Addressed by index, like invoice items and for the same reason: exchange
     * rows carry no _id. ornamentExchanges is a Mixed path, so photos need no
     * schema change - and they are never accepted from the create payload, only
     * written here.
     */
    async addExchangePhotos(
        userId: string,
        recordId: string,
        exchangeIndex: number,
        files: any[],
    ) {
        if (!Types.ObjectId.isValid(recordId)) return null;

        const record = await OrderModel.findOne({
            _id: new Types.ObjectId(recordId),
            userId: new Types.ObjectId(userId),
            deletedAt: null,
        });
        if (!record) return null;

        const rows = (record.ornamentExchanges || []) as any[];
        const row = rows[exchangeIndex];
        if (!Number.isInteger(exchangeIndex) || exchangeIndex < 0 || !row) {
            throw new AppError("Exchange row not found on this record", {
                statusCode: 400,
                code: "BAD_REQUEST",
            });
        }

        const existing = (row.photos || []) as { url: string; fileId: string }[];
        const remaining = MAX_ITEM_PHOTOS - existing.length;
        if (remaining <= 0) {
            throw new AppError(
                `An ornament can hold at most ${MAX_ITEM_PHOTOS} photos`,
                { statusCode: 400, code: "BAD_REQUEST" },
            );
        }

        const shop = await ShopDetail.findOne({ userId }).lean();
        const storageKey = shop?.phone ? String(shop.phone) : userId;

        const uploaded: { url: string; fileId: string }[] = [];
        for (const file of files.slice(0, remaining)) {
            const result = await uploadOrnamentPhoto(
                file,
                storageKey,
                "orders",
                (record as any).invoiceNumber || (record as any).orderNumber || String(record._id),
                `exchanges/${exchangeIndex}`,
            );
            uploaded.push({ url: result.url, fileId: result.fileId });
        }

        // Atomic $set on the exact path, like the item and ornament writes -
        // see addItemPhotos for why doc.save() loses concurrent photo uploads.
        return OrderModel.findOneAndUpdate(
            { _id: record._id, userId: new Types.ObjectId(userId), deletedAt: null },
            { $set: { [`ornamentExchanges.${exchangeIndex}.photos`]: [...existing, ...uploaded] } },
            { new: true },
        );
    },

    /** Best-effort remote delete, like removeItemPhoto: the stored reference is
     *  what the shopkeeper actually sees. */
    async removeExchangePhoto(
        userId: string,
        recordId: string,
        exchangeIndex: number,
        fileId: string,
    ) {
        if (!Types.ObjectId.isValid(recordId)) return null;

        const record = await OrderModel.findOne({
            _id: new Types.ObjectId(recordId),
            userId: new Types.ObjectId(userId),
            deletedAt: null,
        });
        if (!record) return null;

        const rows = (record.ornamentExchanges || []) as any[];
        const row = rows[exchangeIndex];
        if (!row) {
            throw new AppError("Exchange row not found on this record", {
                statusCode: 400,
                code: "BAD_REQUEST",
            });
        }

        const existing = (row.photos || []) as { url: string; fileId: string }[];
        const next = existing.filter(p => p.fileId !== fileId);
        if (next.length === existing.length) {
            throw new AppError("Photo not found", { statusCode: 404, code: "NOT_FOUND" });
        }

        const updated = await OrderModel.findOneAndUpdate(
            { _id: record._id, userId: new Types.ObjectId(userId), deletedAt: null },
            { $set: { [`ornamentExchanges.${exchangeIndex}.photos`]: next } },
            { new: true },
        );

        await deletePhotoIfUnreferenced(userId, fileId);
        return updated;
    },

    async removeItemPhoto(userId: string, orderId: string, itemIndex: number, fileId: string) {
        if (!Types.ObjectId.isValid(orderId)) return null;

        const order = await OrderModel.findOne({
            _id: new Types.ObjectId(orderId),
            userId: new Types.ObjectId(userId),
            deletedAt: null,
        });
        if (!order) return null;

        const item = (order.items || [])[itemIndex] as any;
        if (!item) {
            throw new AppError("Item not found on this order", {
                statusCode: 400,
                code: "BAD_REQUEST",
            });
        }

        const before = (item.photos || []).length;
        item.photos = (item.photos || []).filter((p: any) => p.fileId !== fileId);
        if ((item.photos || []).length === before) {
            throw new AppError("Photo not found", { statusCode: 404, code: "NOT_FOUND" });
        }

        order.markModified("items");
        await order.save();
        await deletePhotoIfUnreferenced(userId, fileId);
        return order;
    },

    async getTrashedOrders(userId: string, dukandarId?: string) {
        const query: any = { userId: new Types.ObjectId(userId), deletedAt: { $ne: null } };
        if (dukandarId) query.dukandarId = new Types.ObjectId(dukandarId);
        return OrderModel.find(query).populate("customerId").sort({ deletedAt: -1 });
    },

    /**
     * Unified logic to complete advance order: Add payment + Create Invoice + Update Status
     */
    async unifiedCompleteAdvanceOrder(
        userId: string,
        orderId: string,
        payload: {
            payment?: AddPaymentDTO;
            invoice: CreateInvoiceDTO;
            dukandarId?: string;
        }
    ) {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const orderIdObj = new Types.ObjectId(orderId);
            const order = await OrderModel.findOne({
                _id: orderIdObj,
                userId: new Types.ObjectId(userId),
            }).session(session).populate("customerId");

            if (!order) {
                throw new AppError("Original order not found", { statusCode: 404, code: "NOT_FOUND" });
            }

            if (order.status === "completed") {
                throw new AppError("Order is already completed", { statusCode: 400, code: "BAD_REQUEST" });
            }

            // 1. Add final payment if provided
            if (payload.payment && payload.payment.amount > 0) {
                const p = payload.payment;
                const weightCovered = p.goldRate > 0 ? (p.amount / p.goldRate) : 0;

                order.payments.push({
                    date: p.date ? new Date(p.date) : new Date(),
                    amount: p.amount,
                    goldRate: p.goldRate,
                    weightCovered,
                    paymentType: "final",
                    notes: p.notes || "Final settlement",
                });

                // Pre-save logic will recalc weightPaid etc when we save 'order' later or here
            }

            // 2. Create the Final Invoice record (If one doesn't already exist for this order)
            let invoice = await InvoiceModel.findOne({ orderId: order._id, userId: new Types.ObjectId(userId) }).session(session);

            if (!invoice) {
                const invoicePayload = { ...payload.invoice, orderId: order._id.toString() };
                if (!invoicePayload.invoiceNumber) {
                    // Use the orderNumber (ADV-X) as the invoiceNumber to link them and avoid wasting INV-X sequence
                    invoicePayload.invoiceNumber = order.orderNumber;
                }

                // Snapshot the full advance-payment history (including the
                // final settlement pushed above) onto the invoice, since the
                // invoice is otherwise a standalone record that never joins
                // back to the Order for reprints.
                invoicePayload.payments = order.payments.map((p: any) => ({
                    date: p.date,
                    amount: p.amount,
                    goldRate: p.goldRate,
                    weightCovered: p.weightCovered,
                    paymentType: p.paymentType,
                    notes: p.notes,
                }));

                // Carry the photos across too, for exactly the reason the
                // payments snapshot above exists: the invoice is a standalone
                // record that never joins back to the Order, so anything left
                // behind here is invisible on the final bill forever.
                //
                // The client's completion payload rebuilds the item list from
                // the form, which carries no photos - so settling an advance
                // order silently produced an invoice with none, while the order
                // it came from still held them. By index, the same handle the
                // upload route and updateInvoice already use. An item that
                // arrives with its own photos keeps them.
                invoicePayload.items = (invoicePayload.items || []).map(
                    (item: any, index: number) => {
                        if (item.photos !== undefined) return item;
                        const stored = (order.items || [])[index] as any;
                        return stored?.photos?.length
                            ? { ...item, photos: stored.photos }
                            : item;
                    },
                );

                // Photos of old gold taken in against the order belong on the
                // final bill for the same reason.
                if (invoicePayload.ornamentPhotos === undefined && (order as any).ornamentPhotos?.length) {
                    invoicePayload.ornamentPhotos = (order as any).ornamentPhotos;
                }

                // Whether to print them is the shopkeeper's choice, made on the
                // order. createInvoice defaults it to false, so without this an
                // order marked "print item photos" produced a bill that did not.
                if (invoicePayload.includeItemPhotosOnBill === undefined) {
                    invoicePayload.includeItemPhotosOnBill = (order as any).includeItemPhotosOnBill;
                }

                const customerId = (order.customerId as any)._id
                    ? (order.customerId as any)._id.toString()
                    : order.customerId.toString();

                invoice = await InvoiceService.createInvoice(
                    userId,
                    customerId,
                    invoicePayload,
                    payload.dukandarId,
                    session
                );
            }

            if (!invoice) {
                throw new AppError("Failed to create or find invoice for completion", { statusCode: 500 });
            }

            // 3. Update Order status and link to invoice
            order.status = "completed";
            order.finalInvoiceId = (invoice as any)._id;
            order.completedAt = new Date();

            await order.save({ session });

            await session.commitTransaction();
            return {
                order: await order.populate("customerId"),
                invoice
            };
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    },
};
