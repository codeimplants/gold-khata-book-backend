import type { Request, Response } from "express";
import asyncHandler from "../../common/middlewares/asyncHandler.middleware";
import type { ApiResponse } from "../../common/types/api";
import { RetailerAccountService } from "./retailerAccount.service";
import {
    receiveCashSchema,
    receiveGoldSchema,
    allocateCashSchema,
    applyMeltCreditSchema,
    creditMeltSchema,
    payOutMeltSchema,
} from "./retailerAccount.schema";

export const RetailerAccountController = {
    /** Every retailer account this shop has used, for totals and the day book. */
    listAccounts: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const accounts = await RetailerAccountService.listAccounts(
                req.auth!.sub,
                req.query.dukandarId as string | undefined,
            );
            res.status(200).json({ success: true, data: accounts });
        },
    ),

    /** Gold left as an advance, held until it is applied to a sale. */
    receiveGold: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { dukandarId, ...payload } = receiveGoldSchema.parse(req.body);
            const account = await RetailerAccountService.receiveGold(
                req.auth!.sub,
                req.params.customerId,
                payload,
                dukandarId,
            );
            res.status(201).json({
                success: true,
                data: account,
                message: "Gold received and held",
            });
        },
    ),

    /** The retailer's held cash, melt credit and the movements behind them. */
    getAccount: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const account = await RetailerAccountService.getAccount(
                req.auth!.sub,
                req.params.customerId,
                req.query.dukandarId as string | undefined,
            );
            res.status(200).json({ success: true, data: account });
        },
    ),

    receiveCash: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { dukandarId, ...payload } = receiveCashSchema.parse(req.body);
            const account = await RetailerAccountService.receiveCash(
                req.auth!.sub,
                req.params.customerId,
                payload,
                dukandarId,
            );
            res.status(201).json({
                success: true,
                data: account,
                message: "Cash received and held",
            });
        },
    ),

    allocateCash: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { dukandarId, ...payload } = allocateCashSchema.parse(req.body);
            const result = await RetailerAccountService.allocateCash(
                req.auth!.sub,
                req.params.customerId,
                payload,
                dukandarId,
            );
            res.status(200).json({
                success: true,
                data: result,
                message: "Cash allocated",
            });
        },
    ),

    refundCash: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { dukandarId, ...payload } = receiveCashSchema.parse(req.body);
            const account = await RetailerAccountService.refundCash(
                req.auth!.sub,
                req.params.customerId,
                payload,
                dukandarId,
            );
            res.status(200).json({
                success: true,
                data: account,
                message: "Cash refunded",
            });
        },
    ),

    /**
     * Credits fine weight to the retailer. The melt lot record will call the
     * service directly once it exists; this is the same action exposed for a
     * credit entered by hand.
     */
    creditMelt: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { dukandarId, weight, melt, date, notes } = creditMeltSchema.parse(req.body);
            const account = await RetailerAccountService.creditMelt(
                req.auth!.sub,
                req.params.customerId,
                weight,
                { date, notes, dukandarId, melt },
            );
            res.status(201).json({
                success: true,
                data: account,
                message: "Melt credit added",
            });
        },
    ),

    applyMeltCredit: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { dukandarId, ...payload } = applyMeltCreditSchema.parse(req.body);
            const result = await RetailerAccountService.applyMeltCredit(
                req.auth!.sub,
                req.params.customerId,
                payload,
                dukandarId,
            );
            res.status(200).json({
                success: true,
                data: result,
                message: "Melt credit applied",
            });
        },
    ),

    payOutMelt: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { dukandarId, ...payload } = payOutMeltSchema.parse(req.body);
            const account = await RetailerAccountService.payOutMelt(
                req.auth!.sub,
                req.params.customerId,
                payload,
                dukandarId,
            );
            res.status(200).json({
                success: true,
                data: account,
                message: "Melt credit paid out",
            });
        },
    ),
};
