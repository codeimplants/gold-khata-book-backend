import { Types } from "mongoose";
import {
    RetailerAccountModel,
    CASH_SETTLED_EPSILON,
    WEIGHT_SETTLED_EPSILON_GM,
} from "./retailerAccount.model";
import type {
    ReceiveCashDTO,
    ReceiveGoldDTO,
    AllocateCashDTO,
    ApplyMeltCreditDTO,
    SilverHeldDTO,
    ApplySilverHeldDTO,
    MeltLot,
} from "./retailerAccount.types";
import { OrderService } from "../order/order.service";
import { AppError } from "../../common/errors/AppError";
import { SETTLEMENT_FINENESS, priceInboundMetal } from "../../common/utils/goldPricing";

const oid = (v: string) => new Types.ObjectId(v);

export const RetailerAccountService = {
    /**
     * The retailer's account, created empty on first touch.
     *
     * Upsert rather than find-then-create: two payments landing together would
     * otherwise race to create the same account, and the unique index would
     * turn the loser into a 500 on a perfectly ordinary action.
     */
    async getAccount(userId: string, customerId: string, dukandarId?: string) {
        const account = await RetailerAccountModel.findOneAndUpdate(
            { userId: oid(userId), customerId: oid(customerId) },
            {
                $setOnInsert: {
                    userId: oid(userId),
                    customerId: oid(customerId),
                    ...(dukandarId ? { dukandarId: oid(dukandarId) } : {}),
                    entries: [],
                },
            },
            { new: true, upsert: true },
        );
        return account;
    },

    /**
     * Every account this shop holds anything on, or ever has.
     *
     * For the khata home ("held for retailers") and the day book, which list
     * cash held and gold advances alongside sales. Only accounts with entries:
     * the per-retailer route upserts an empty account on first view, and those
     * hold nothing worth sending.
     */
    async listAccounts(userId: string, dukandarId?: string) {
        return RetailerAccountModel.find({
            userId: oid(userId),
            ...(dukandarId ? { dukandarId: oid(dukandarId) } : {}),
            "entries.0": { $exists: true },
        });
    },

    /**
     * Cash in, deliberately unapplied.
     *
     * The retailer's own choice: he hands over money but keeps his metal
     * position open, waiting for a rate he likes. Nothing is settled here — see
     * allocateCash, which is where a rate finally gets attached.
     */
    async receiveCash(
        userId: string,
        customerId: string,
        payload: ReceiveCashDTO,
        dukandarId?: string,
    ) {
        if (!payload.amount || payload.amount <= 0) {
            throw new AppError("Enter an amount to receive", {
                statusCode: 400,
                code: "BAD_REQUEST",
            });
        }

        const account = await this.getAccount(userId, customerId, dukandarId);
        account.entries.push({
            date: payload.date || new Date(),
            type: "cash-received",
            cashDelta: payload.amount,
            metalDelta: 0,
            // Only an overpayment carries one, set by OrderService — the route
            // schema does not accept it. See ReceiveCashDTO.orderId.
            ...(payload.orderId ? { orderId: oid(payload.orderId) } : {}),
            notes: payload.notes,
        });
        await account.save();
        return account;
    },

    /**
     * Gold in, held rather than set against a bill.
     *
     * A retailer leaving metal ahead of the purchases it is meant for, or
     * handing over gold while a sale is still being weighed up. Credited in
     * 99.50 terms by `priceInboundMetal`, the same inbound rule a metal payment
     * on an order goes through, so a gram left here is worth exactly what it
     * would have been worth paid against a sale. Applying it later is the melt
     * credit path (`applyMeltCredit`): gram for gram, no rate.
     */
    async receiveGold(
        userId: string,
        customerId: string,
        payload: ReceiveGoldDTO,
        dukandarId?: string,
    ) {
        const credit = priceInboundMetal(payload.weight, payload.purity);
        if (!(credit > 0)) {
            throw new AppError("Enter the weight and purity of the gold", {
                statusCode: 400,
                code: "BAD_REQUEST",
            });
        }

        const account = await this.getAccount(userId, customerId, dukandarId);
        account.entries.push({
            date: payload.date || new Date(),
            type: "gold-received",
            cashDelta: 0,
            metalDelta: credit,
            goldWeight: payload.weight,
            goldPurity: payload.purity,
            notes: payload.notes,
        });
        await account.save();
        return account;
    },

    /**
     * Draws held cash down onto an order, buying metal at the rate on the day
     * of ALLOCATION — never the day the cash arrived. That difference is the
     * whole reason the retailer left it held, so the rate is required here
     * rather than remembered from the receipt.
     *
     * The order side goes through OrderService.addPayment rather than touching
     * the order directly: that path already carries the settled-weight epsilon,
     * the two-account split and the completion rule, and a second
     * implementation of any of them would drift.
     */
    async allocateCash(
        userId: string,
        customerId: string,
        payload: AllocateCashDTO,
        dukandarId?: string,
    ) {
        const account = await this.getAccount(userId, customerId, dukandarId);

        if (!payload.amount || payload.amount <= 0) {
            throw new AppError("Enter an amount to allocate", {
                statusCode: 400,
                code: "BAD_REQUEST",
            });
        }
        const silver = payload.metal === "silver";
        if (!payload.goldRate || payload.goldRate <= 0) {
            throw new AppError(silver
                ? "A silver rate is required to allocate cash against silver"
                : "A gold rate is required to allocate cash against metal", {
                statusCode: 400,
                code: "BAD_REQUEST",
            });
        }
        if (payload.amount > account.heldCash + CASH_SETTLED_EPSILON) {
            throw new AppError(
                `Only ${account.heldCash.toFixed(2)} is held for this retailer`,
                { statusCode: 400, code: "BAD_REQUEST" },
            );
        }

        // The order first. If it rejects — already completed, not found, not
        // this shop's — the account must not have been drawn down, so the
        // balance is only moved once the payment is on the order.
        const order = await OrderService.addPayment(
            userId,
            payload.orderId,
            {
                amount: payload.amount,
                goldRate: payload.goldRate,
                // Silver's due is its own account: the same cash, filed under
                // silver at the silver rate, never gold at a silver rate.
                settles: silver ? "silver" : "metal",
                date: payload.date,
                // Marks the payment as money already held, not money handed
                // over today: the day book counted it when it came in.
                paymentType: "credit",
                notes: payload.notes || "Allocated from held cash",
            },
            dukandarId,
        );

        account.entries.push({
            date: payload.date || new Date(),
            type: "cash-allocated",
            cashDelta: -payload.amount,
            metalDelta: 0,
            ...(silver ? { metal: "silver" as const } : {}),
            rate: payload.goldRate,
            orderId: oid(payload.orderId),
            notes: payload.notes,
        });
        await account.save();

        return { account, order };
    },

    /**
     * Silver in, held rather than set against a bill: a silver advance.
     *
     * Gram for gram, with no purity: a silver sale charges net weight and
     * nothing else (silverPricing.ts), so the silver coming in is counted the
     * same way. Applying it later is applySilverHeld.
     */
    async receiveSilver(
        userId: string,
        customerId: string,
        payload: SilverHeldDTO,
        dukandarId?: string,
    ) {
        if (!payload.weight || payload.weight <= 0) {
            throw new AppError("Enter the weight of the silver", { statusCode: 400, code: "BAD_REQUEST" });
        }
        const account = await this.getAccount(userId, customerId, dukandarId);
        account.entries.push({
            date: payload.date || new Date(),
            type: "silver-received",
            cashDelta: 0,
            metalDelta: 0,
            silverDelta: payload.weight,
            notes: payload.notes,
        });
        await account.save();
        return account;
    },

    /**
     * Draws silver held down onto a sale's silver due, gram for gram.
     *
     * Through OrderService.addPayment as a silver payment, for the same reason
     * allocateCash goes through it: the completion rule lives there. Order
     * first, so a refused payment never draws the account down.
     */
    async applySilverHeld(
        userId: string,
        customerId: string,
        payload: ApplySilverHeldDTO,
        dukandarId?: string,
    ) {
        const account = await this.getAccount(userId, customerId, dukandarId);

        if (!payload.weight || payload.weight <= 0) {
            throw new AppError("Enter a weight to apply", { statusCode: 400, code: "BAD_REQUEST" });
        }
        if (payload.weight > (account.silverHeld || 0) + WEIGHT_SETTLED_EPSILON_GM) {
            throw new AppError(
                `Only ${(account.silverHeld || 0).toFixed(3)} gm of silver is held for this retailer`,
                { statusCode: 400, code: "BAD_REQUEST" },
            );
        }

        const order = await OrderService.addPayment(
            userId,
            payload.orderId,
            {
                amount: 0,
                goldRate: 0,
                silverWeight: payload.weight,
                settles: "silver",
                date: payload.date,
                // Silver already held, counted when it came in. See allocateCash.
                paymentType: "credit",
                notes: payload.notes || "Applied from silver held",
            },
            dukandarId,
        );

        account.entries.push({
            date: payload.date || new Date(),
            type: "silver-applied",
            cashDelta: 0,
            metalDelta: 0,
            silverDelta: -payload.weight,
            orderId: oid(payload.orderId),
            notes: payload.notes,
        });
        await account.save();

        return { account, order };
    },

    /** Silver held handed back to the retailer rather than used. */
    async returnSilver(
        userId: string,
        customerId: string,
        payload: SilverHeldDTO,
        dukandarId?: string,
    ) {
        const account = await this.getAccount(userId, customerId, dukandarId);

        if (!payload.weight || payload.weight <= 0) {
            throw new AppError("Enter a weight to return", { statusCode: 400, code: "BAD_REQUEST" });
        }
        if (payload.weight > (account.silverHeld || 0) + WEIGHT_SETTLED_EPSILON_GM) {
            throw new AppError(
                `Only ${(account.silverHeld || 0).toFixed(3)} gm of silver is held for this retailer`,
                { statusCode: 400, code: "BAD_REQUEST" },
            );
        }

        account.entries.push({
            date: payload.date || new Date(),
            type: "silver-returned",
            cashDelta: 0,
            metalDelta: 0,
            silverDelta: -payload.weight,
            notes: payload.notes,
        });
        await account.save();
        return account;
    },

    /** Held cash handed back rather than spent. */
    async refundCash(
        userId: string,
        customerId: string,
        payload: ReceiveCashDTO,
        dukandarId?: string,
    ) {
        const account = await this.getAccount(userId, customerId, dukandarId);

        if (!payload.amount || payload.amount <= 0) {
            throw new AppError("Enter an amount to refund", {
                statusCode: 400,
                code: "BAD_REQUEST",
            });
        }
        if (payload.amount > account.heldCash + CASH_SETTLED_EPSILON) {
            throw new AppError(
                `Only ${account.heldCash.toFixed(2)} is held for this retailer`,
                { statusCode: 400, code: "BAD_REQUEST" },
            );
        }

        account.entries.push({
            date: payload.date || new Date(),
            type: "cash-refunded",
            cashDelta: -payload.amount,
            metalDelta: 0,
            notes: payload.notes,
        });
        await account.save();
        return account;
    },

    /**
     * Credits a completed melt lot's fine weight.
     *
     * `weight` is already in 99.50 terms — the melt chain does that conversion
     * when the lot is tested, so nothing is converted again here.
     */
    async creditMelt(
        userId: string,
        customerId: string,
        weight: number,
        opts: { date?: Date; notes?: string; dukandarId?: string; melt?: MeltLot } = {},
    ) {
        if (!weight || weight <= 0) {
            throw new AppError("A melt credit needs a weight", {
                statusCode: 400,
                code: "BAD_REQUEST",
            });
        }

        const account = await this.getAccount(userId, customerId, opts.dukandarId);
        account.entries.push({
            date: opts.date || new Date(),
            type: "melt-credited",
            cashDelta: 0,
            metalDelta: weight,
            // The weighings behind the figure, when the screen sent them. What
            // makes a disputed lot answerable later — see MeltLot.
            ...(opts.melt ? { melt: opts.melt } : {}),
            notes: opts.notes,
        });
        await account.save();
        return account;
    },

    /**
     * Draws melt credit down onto an order.
     *
     * Recorded as a payment in metal at settlement fineness, because that is
     * exactly what it is: gold the wholesaler is already holding, applied to a
     * bill. Passing it at SETTLEMENT_FINENESS means the inbound conversion in
     * the order hook is a no-op — the weight has been in 99.50 terms since the
     * lot was tested, and converting it twice would credit it a second uplift.
     */
    async applyMeltCredit(
        userId: string,
        customerId: string,
        payload: ApplyMeltCreditDTO,
        dukandarId?: string,
    ) {
        const account = await this.getAccount(userId, customerId, dukandarId);

        if (!payload.weight || payload.weight <= 0) {
            throw new AppError("Enter a weight to apply", {
                statusCode: 400,
                code: "BAD_REQUEST",
            });
        }
        if (payload.weight > account.meltCredit + WEIGHT_SETTLED_EPSILON_GM) {
            throw new AppError(
                `Only ${account.meltCredit.toFixed(3)} gm of credit is held for this retailer`,
                { statusCode: 400, code: "BAD_REQUEST" },
            );
        }

        const order = await OrderService.addPayment(
            userId,
            payload.orderId,
            {
                amount: 0,
                goldRate: 0,
                goldWeight: payload.weight,
                goldPurity: SETTLEMENT_FINENESS,
                settles: "metal",
                date: payload.date,
                // Metal already held, counted when it came in. See allocateCash.
                paymentType: "credit",
                notes: payload.notes || "Applied from gold held",
            },
            dukandarId,
        );

        account.entries.push({
            date: payload.date || new Date(),
            type: "melt-applied",
            cashDelta: 0,
            metalDelta: -payload.weight,
            orderId: oid(payload.orderId),
            notes: payload.notes,
        });
        await account.save();

        return { account, order };
    },

    /** Melt credit taken out as cash or handed back as fine gold. */
    async payOutMelt(
        userId: string,
        customerId: string,
        payload: { weight: number; rate?: number; date?: Date; notes?: string },
        dukandarId?: string,
    ) {
        const account = await this.getAccount(userId, customerId, dukandarId);

        if (!payload.weight || payload.weight <= 0) {
            throw new AppError("Enter a weight to pay out", {
                statusCode: 400,
                code: "BAD_REQUEST",
            });
        }
        if (payload.weight > account.meltCredit + WEIGHT_SETTLED_EPSILON_GM) {
            throw new AppError(
                `Only ${account.meltCredit.toFixed(3)} gm of credit is held for this retailer`,
                { statusCode: 400, code: "BAD_REQUEST" },
            );
        }

        account.entries.push({
            date: payload.date || new Date(),
            type: "melt-paid-out",
            cashDelta: 0,
            metalDelta: -payload.weight,
            // Present when it left as cash, absent when it left as metal —
            // which is how the two are told apart later.
            rate: payload.rate,
            notes: payload.notes,
        });
        await account.save();
        return account;
    },
};
