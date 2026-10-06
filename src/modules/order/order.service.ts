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
import { ShopDetail } from "../shopDetail/shopDetails.model";
import { uploadOrnamentPhoto, deleteImageByFileId } from "../../common/utils/imageKit";
import { deletePhotoIfUnreferenced, collectPhotoFileIds, releasePhotos } from "../../common/utils/photoReferences";

/** Mirrors MAX_DECLARATION_PHOTOS — the same ornaments, the same limit. */
const MAX_ORNAMENT_PHOTOS = 6;
/** Per item, not per order — matches InvoiceService.MAX_ITEM_PHOTOS. */
const MAX_ITEM_PHOTOS = 4;
import mongoose from "mongoose";
import { nextDocumentNumber } from "../../common/utils/documentNumber";

export const OrderService = {
    /**
     * The next number in this shop's single document series — see
     * documentNumber.ts. Orders and invoices share it, so an order is INV-n
     * like everything else rather than carrying its own ADV-n sequence.
     */
    async generateOrderNumber(userId: string, dukandarId?: string): Promise<string> {
        return nextDocumentNumber(userId, dukandarId);
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
        const orderNumber = await this.generateOrderNumber(userId, dukandarId);

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

        /**
         * Clamped, because `remainingWeight` has `min: 0` on the schema and
         * Mongoose validates BEFORE this file's pre-save hook gets to run.
         *
         * The hook already computes this properly — from the fine-99.50 total
         * rather than the raw item grams, and with its own Math.max(0, …) — but
         * it never got the chance: Mongoose registers validation as a pre-save
         * hook in the Schema constructor, so it runs ahead of every hook added
         * afterwards and rejected the constructor's raw value first.
         *
         * That made any payment larger than the order fail to save at all, with
         * "remainingWeight (-37.959…) is less than minimum allowed value (0)" —
         * on a screen that had just said "Full payment". Overpaying is a normal
         * thing to do at a counter, and it was the one thing that could not be
         * recorded.
         */
        const remainingWeight = Math.max(0, totalWeight - weightPaid);
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
            gstRate: payload.gstRate ?? 3,
            includeItemPhotosOnBill: payload.includeItemPhotosOnBill ?? false,
            status,
        });
        // estimatedBalance/amount/subTotal/gstAmount are computed in the
        // pre-save hook (order.model.ts) from items + GST, and
        // recomputed on every subsequent save (e.g. addPayment).

        await order.save();
        // An order can be overpaid at the moment it is raised, so the surplus
        // has to be swept here as well as on later payments.
        await this.creditOverpayment(order, userId, dukandarId);
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
     * Turns anything paid beyond an order into credit on the retailer's account.
     *
     * Overpaying is ordinary at a counter — a retailer rounds up, or hands over
     * a lump that covers this bill and starts on the next. Until now the
     * surplus simply vanished: `remainingWeight` clamps at 0, so an order paid
     * 10.0258 gm against a 10.000 gm total recorded the 0.0258 gm nowhere at
     * all, and the shopkeeper had no record of owing it back.
     *
     * It lands in `heldCash` rather than being netted off the next bill,
     * because that is the whole design of the retailer account: netting hides
     * that the wholesaler is holding someone else's money, which is exactly
     * what both sides need to see plainly. `cash/allocate` is what draws it
     * down later, at the rate on the day it is allocated.
     *
     * Priced in RUPEES at the order's own rate. The surplus arises in grams,
     * but a shopkeeper who overpays by Rs.400 expects to see Rs.400 — and
     * pricing it at the rate the order was transacted at is the only rate both
     * parties have already agreed to.
     *
     * `creditedExcessWeight` makes this idempotent: a second save of the same
     * order credits only what has appeared since the last one, so re-saving an
     * order or adding a further payment can never credit the same surplus twice.
     *
     * Deliberately best-effort. The payment itself is already recorded and the
     * order is correct; failing the whole request because the credit could not
     * be written would lose the payment to save the bookkeeping.
     */
    async creditOverpayment(order: any, userId: string, dukandarId?: string) {
        const excess = (order.weightPaid || 0) - (order.totalWeight || 0);
        const delta = excess - (order.creditedExcessWeight || 0);
        if (delta <= WEIGHT_SETTLED_EPSILON_GM) return;

        const rate = weightedItemRate(order.items, order.bookingRate) || order.bookingRate || 0;
        if (rate <= 0) return;

        const amount = Number((delta * rate).toFixed(2));
        if (amount < 0.5) return;

        try {
            // Imported here rather than at the top of the file: the retailer
            // account service imports THIS module, and a top-level import both
            // ways is a require cycle whose loser resolves to undefined.
            const { RetailerAccountService } = await import(
                "../retailerAccount/retailerAccount.service"
            );
            await RetailerAccountService.receiveCash(
                userId,
                String(order.customerId?._id || order.customerId),
                {
                    amount,
                    // Dated with the payment that overpaid, not the moment this
                    // ran: a back-dated receipt's surplus belongs on the same
                    // day in the day book, not today.
                    date: (() => {
                        const last = (order.payments || [])
                            .map((p: any) => new Date(p.date).getTime())
                            .filter((t: number) => Number.isFinite(t))
                            .sort((a: number, b: number) => b - a)[0];
                        return last ? new Date(last) : new Date();
                    })(),
                    notes: `Overpaid on ${order.orderNumber || "order"}`,
                    // So the day book reads this as a surplus moved across,
                    // not as cash handed over a second time.
                    orderId: String(order._id),
                },
                dukandarId,
            );

            order.creditedExcessWeight = excess;
            await order.save();
        } catch (err) {
            console.warn(
                "[OrderService] could not credit overpayment on",
                order.orderNumber,
                err instanceof Error ? err.message : err,
            );
        }
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

        const settles = payload.settles || "metal";

        // Only cash aimed at metal converts to grams. Cash clearing the charges
        // account buys no weight, so it carries none.
        const weightCovered =
            settles !== "cash" && payload.goldRate > 0
                ? (payload.amount / payload.goldRate)
                : 0;

        // Add new payment
        order.payments.push({
            date: payload.date || new Date(),
            amount: payload.amount || 0,
            goldRate: payload.goldRate || 0,
            weightCovered,
            goldWeight: payload.goldWeight,
            goldPurity: payload.goldPurity,
            settles,
            paymentType: payload.paymentType || "advance",
            notes: payload.notes,
        });

        // Recalculate totals (pre-save hook will handle this)
        await order.save();

        // An order is finished only when BOTH accounts are clear. Completing on
        // settled metal alone would close orders that still owe making charges
        // and GST, and closing zeroes both balances — the debt would not just be
        // hidden, it would be erased.
        //
        // Weight is compared with a tolerance because weightPaid is not rounded
        // to 3dp — see WEIGHT_SETTLED_EPSILON_GM.
        const metalSettled = order.totalWeight - order.weightPaid < WEIGHT_SETTLED_EPSILON_GM;
        const cashSettled = (order.outstandingCash || 0) <= 0;

        if (metalSettled && cashSettled) {
            order.status = "completed";
            order.completedAt = new Date();
            await order.save();
        }

        // After the status write, so a payment that both settles and overpays
        // records the surplus against a completed order rather than a pending
        // one — which is what the retailer's statement then reads.
        await this.creditOverpayment(order, userId, dukandarId);

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

        const fileIds = collectPhotoFileIds(order.toObject ? order.toObject() : order);

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
    /** Best-effort remote delete, like removeItemPhoto: the stored reference is
     *  what the shopkeeper actually sees. */

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
