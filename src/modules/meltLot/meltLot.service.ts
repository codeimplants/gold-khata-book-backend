import { Types } from "mongoose";
import { MeltLotModel } from "./meltLot.model";
import type { CreateMeltLotDTO, RecordMeltDTO, RecordTestDTO } from "./meltLot.types";
import { RetailerAccountService } from "../retailerAccount/retailerAccount.service";
import { priceInboundMetal } from "../../common/utils/goldPricing";
import { AppError } from "../../common/errors/AppError";

const oid = (v: string) => new Types.ObjectId(v);

/** Same 3dp rounding the pricing module uses; it keeps that helper private. */
const round3 = (n: number): number => Number((Number(n) || 0).toFixed(3));

export const MeltLotService = {
    async getById(userId: string, lotId: string, dukandarId?: string) {
        const query: any = { _id: oid(lotId), userId: oid(userId) };
        if (dukandarId) query.dukandarId = oid(dukandarId);

        const lot = await MeltLotModel.findOne(query).populate("customerId");
        if (!lot) {
            throw new AppError("Melt lot not found", { statusCode: 404, code: "NOT_FOUND" });
        }
        return lot;
    },

    /**
     * Lots for this shop, newest first.
     *
     * `open` is the view the feature exists for — everything still waiting on a
     * reading — so it is a status of its own rather than something each caller
     * assembles out of the two underlying values and gets subtly wrong.
     */
    async list(
        userId: string,
        opts: { status?: string; customerId?: string; dukandarId?: string } = {},
    ) {
        const query: any = { userId: oid(userId) };
        if (opts.dukandarId) query.dukandarId = oid(opts.dukandarId);
        if (opts.customerId) query.customerId = oid(opts.customerId);

        if (opts.status === "open") query.status = { $in: ["received", "melted"] };
        else if (opts.status) query.status = opts.status;

        return MeltLotModel.find(query).populate("customerId").sort({ createdAt: -1 });
    },

    /** Stage 1 — ornaments over the counter, weighed into the pot. */
    async create(
        userId: string,
        customerId: string,
        payload: CreateMeltLotDTO,
        dukandarId?: string,
    ) {
        const lot = new MeltLotModel({
            userId: oid(userId),
            customerId: oid(customerId),
            ...(dukandarId ? { dukandarId: oid(dukandarId) } : {}),
            status: "received",
            potWeight: payload.potWeight,
            receivedAt: payload.receivedAt || new Date(),
            notes: payload.notes,
        });
        await lot.save();
        return lot.populate("customerId");
    },

    /**
     * Stage 2 — the lagdi out of the pot.
     *
     * Rejected once the lot is closed: a tested lot has already put credit on
     * the retailer's account, and letting an earlier weighing change underneath
     * it would leave the credit unexplainable by its own stages.
     */
    async recordMelt(
        userId: string,
        lotId: string,
        payload: RecordMeltDTO,
        dukandarId?: string,
    ) {
        const lot = await this.getById(userId, lotId, dukandarId);

        if (lot.status === "tested") {
            throw new AppError("This lot has already been tested and credited", {
                statusCode: 400,
                code: "BAD_REQUEST",
            });
        }
        // Metal only ever leaves a lot. A melted weight above the pot weight is
        // a typo, and one that would inflate the credit at the end.
        if (payload.afterMelt > lot.potWeight) {
            throw new AppError(
                `Weight after melting cannot exceed the ${lot.potWeight} g that went into the pot`,
                { statusCode: 400, code: "BAD_REQUEST" },
            );
        }

        lot.afterMelt = payload.afterMelt;
        lot.meltedAt = payload.meltedAt || new Date();
        lot.status = "melted";
        if (payload.notes) lot.notes = payload.notes;

        await lot.save();
        return lot.populate("customerId");
    },

    /**
     * Stage 3 — tested, priced and credited. This is what closes a lot.
     *
     * The credit is issued HERE and nowhere earlier, because the fine weight
     * cannot be known until the purity is: a lot sitting in the pot is not
     * credit the retailer holds, it is ornaments the shop is holding.
     *
     * Priced with `priceInboundMetal`, the INBOUND rule. Metal being bought
     * converts 99.9 to 99.50 by a flat trade uplift, not by the ratio the
     * outbound direction uses — see the note in goldPricing.ts. Using the wrong
     * one here hands the wholesaler's margin back on every lot.
     */
    async recordTest(
        userId: string,
        lotId: string,
        payload: RecordTestDTO,
        dukandarId?: string,
    ) {
        const lot = await this.getById(userId, lotId, dukandarId);

        if (lot.status === "tested") {
            throw new AppError("This lot has already been tested and credited", {
                statusCode: 400,
                code: "BAD_REQUEST",
            });
        }
        if (lot.afterMelt == null) {
            throw new AppError("Record the weight after melting first", {
                statusCode: 400,
                code: "BAD_REQUEST",
            });
        }
        if (payload.afterTesting > lot.afterMelt) {
            throw new AppError(
                `Weight after testing cannot exceed the ${lot.afterMelt} g that came out of the pot`,
                { statusCode: 400, code: "BAD_REQUEST" },
            );
        }

        const fine999 = round3((payload.afterTesting * payload.purity) / 100);
        const creditedWeight = priceInboundMetal(payload.afterTesting, payload.purity);

        if (creditedWeight <= 0) {
            throw new AppError("This lot works out to no fine weight", {
                statusCode: 400,
                code: "BAD_REQUEST",
            });
        }

        // The account first. If crediting fails the lot stays open and can be
        // tested again; closing it first would leave a lot marked credited with
        // nothing on the retailer's account to show for it.
        await RetailerAccountService.creditMelt(
            userId,
            String(lot.customerId?._id || lot.customerId),
            creditedWeight,
            {
                date: payload.testedAt || new Date(),
                notes: `Melt lot ${lot.lotNumber}`,
                dukandarId,
                melt: {
                    potWeight: lot.potWeight,
                    afterMelt: lot.afterMelt,
                    afterTesting: payload.afterTesting,
                    purity: payload.purity,
                    fine999,
                },
            },
        );

        lot.afterTesting = payload.afterTesting;
        lot.purity = payload.purity;
        lot.testedAt = payload.testedAt || new Date();
        lot.fine999 = fine999;
        lot.creditedWeight = creditedWeight;
        lot.status = "tested";
        if (payload.notes) lot.notes = payload.notes;

        await lot.save();
        return lot.populate("customerId");
    },

    /**
     * Deletes a lot that has not been credited.
     *
     * A tested lot is refused: its credit is on the retailer's account and may
     * already have been spent against a bill, so removing the lot would delete
     * the only explanation of a balance that still exists.
     */
    async remove(userId: string, lotId: string, dukandarId?: string) {
        const lot = await this.getById(userId, lotId, dukandarId);

        if (lot.status === "tested") {
            throw new AppError(
                "A credited lot cannot be deleted — the credit is on the retailer's account",
                { statusCode: 400, code: "BAD_REQUEST" },
            );
        }

        await MeltLotModel.deleteOne({ _id: lot._id });
        return { id: String(lot._id) };
    },
};
