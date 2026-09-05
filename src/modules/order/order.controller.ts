import type { Request, Response } from "express";
import asyncHandler from "../../common/middlewares/asyncHandler.middleware";
import type { ApiResponse } from "../../common/types/api";
import { OrderService } from "./order.service";
import type { CreateOrderDTO, AddPaymentDTO, UpdateOrderDTO } from "./order.types";
import { createOrderSchema, addPaymentSchema, unifiedCompleteOrderSchema } from "./order.schema";
import { AppError } from "../../common/errors/AppError";

export const OrderController = {
    createOrder: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            // Validate request body
            const validated = createOrderSchema.parse(req.body);
            const { customerId, dukandarId, ...rest } = validated;
            const payload = rest as any as CreateOrderDTO;

            const order = await OrderService.createOrder(
                req.auth!.sub,
                customerId,
                payload,
                dukandarId
            );

            res.status(201).json({
                success: true,
                data: order,
                message: "Order created successfully",
            });
        }
    ),

    getAllOrders: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { customerId, status, dukandarId } = req.query;

            const orders = await OrderService.getAllOrders(
                req.auth!.sub,
                customerId as string | undefined,
                status as string | undefined,
                dukandarId as string | undefined
            );

            res.status(200).json({
                success: true,
                data: orders,
            });
        }
    ),

    getOrderById: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { id } = req.params;
            const { dukandarId } = req.query;

            const order = await OrderService.getOrderById(
                req.auth!.sub,
                id,
                dukandarId as string | undefined
            );

            res.status(200).json({
                success: true,
                data: order,
            });
        }
    ),

    addPayment: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { id } = req.params;

            // Validate request body
            const validated = addPaymentSchema.parse(req.body);
            const { dukandarId, ...rest } = validated;
            const payload = rest as any as AddPaymentDTO;

            const order = await OrderService.addPayment(
                req.auth!.sub,
                id,
                payload,
                dukandarId
            );

            res.status(200).json({
                success: true,
                data: order,
                message: "Payment added successfully",
            });
        }
    ),

    getPaymentHistory: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { id } = req.params;
            const { dukandarId } = req.query;

            const payments = await OrderService.getPaymentHistory(
                req.auth!.sub,
                id,
                dukandarId as string | undefined
            );

            res.status(200).json({
                success: true,
                data: payments,
            });
        }
    ),

    updatePayment: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { id, paymentId } = req.params;
            const { dukandarId, ...payload } = req.body || {};

            const order = await OrderService.updatePayment(
                req.auth!.sub,
                id,
                paymentId,
                payload as AddPaymentDTO,
                dukandarId
            );

            res.status(200).json({
                success: true,
                data: order,
                message: "Payment updated successfully",
            });
        }
    ),

    deletePayment: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { id, paymentId } = req.params;
            const { dukandarId } = req.query;

            const order = await OrderService.deletePayment(
                req.auth!.sub,
                id,
                paymentId,
                dukandarId as string | undefined
            );

            res.status(200).json({
                success: true,
                data: order,
                message: "Payment deleted successfully",
            });
        }
    ),

    updateOrder: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { id } = req.params;
            const { dukandarId, ...rest } = req.body || {};
            const payload = rest as UpdateOrderDTO;

            const order = await OrderService.updateOrder(
                req.auth!.sub,
                id,
                payload,
                dukandarId
            );

            res.status(200).json({
                success: true,
                data: order,
                message: "Order updated successfully",
            });
        }
    ),

    completeOrder: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { id } = req.params;
            const { invoiceId, dukandarId } = req.body || {};

            const order = await OrderService.completeOrder(
                req.auth!.sub,
                id,
                invoiceId,
                dukandarId
            );

            res.status(200).json({
                success: true,
                data: order,
                message: "Order completed successfully",
            });
        }
    ),

    unifiedCompleteOrder: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            // Validate request body
            const validated = unifiedCompleteOrderSchema.parse(req.body);
            const { orderId, payment, invoice, dukandarId } = validated;

            const result = await OrderService.unifiedCompleteAdvanceOrder(
                req.auth!.sub,
                orderId,
                { payment, invoice, dukandarId }
            );

            res.status(200).json({
                success: true,
                data: result,
                message: "Advance order completed and invoice generated successfully",
            });
        }
    ),

    cancelOrder: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { id } = req.params;
            const { dukandarId } = req.body || {};

            const order = await OrderService.cancelOrder(
                req.auth!.sub,
                id,
                dukandarId
            );

            res.status(200).json({
                success: true,
                data: order,
                message: "Order cancelled successfully",
            });
        }
    ),

    deleteOrder: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { id } = req.params;
            const { dukandarId } = req.query;

            await OrderService.deleteOrder(
                req.auth!.sub,
                id,
                dukandarId as string | undefined
            );

            res.status(200).json({
                success: true,
                data: null,
                message: "Order deleted successfully",
            });
        }
    ),

    trashOrder: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { id } = req.params;
            const { dukandarId } = req.query;
            const order = await OrderService.trashOrder(req.auth!.sub, id, dukandarId as string | undefined);
            res.status(200).json({ success: true, data: order, message: "Order moved to trash" });
        }
    ),

    restoreOrder: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { id } = req.params;
            const { dukandarId } = req.query;
            const order = await OrderService.restoreOrder(req.auth!.sub, id, dukandarId as string | undefined);
            res.status(200).json({ success: true, data: order, message: "Order restored" });
        }
    ),

    /**
     * Attaches photos of the old ornaments taken in against this order.
     *
     * Non-fatal by design on the client: the order is already saved and usable,
     * and photos are an optional record. Failing here must never imply the order
     * itself did not save.
     */
    addItemPhotos: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const files = (req.files as any[]) || [];
            if (files.length === 0) {
                throw new AppError("No photos uploaded", {
                    statusCode: 400,
                    code: "BAD_REQUEST",
                });
            }
            const order = await OrderService.addItemPhotos(
                req.auth!.sub,
                req.params.id,
                Number(req.params.itemIndex),
                files
            );
            if (!order) {
                throw new AppError("Order not found", { statusCode: 404, code: "NOT_FOUND" });
            }
            res.status(200).json({ success: true, data: order, message: "Photos added" });
        }
    ),



    removeItemPhoto: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const order = await OrderService.removeItemPhoto(
                req.auth!.sub,
                req.params.id,
                Number(req.params.itemIndex),
                req.params.fileId
            );
            if (!order) {
                throw new AppError("Order not found", { statusCode: 404, code: "NOT_FOUND" });
            }
            res.status(200).json({ success: true, data: order, message: "Photo removed" });
        }
    ),



    getTrashedOrders: asyncHandler(
        async (req: Request, res: Response<ApiResponse<unknown>>) => {
            const { dukandarId } = req.query;
            const orders = await OrderService.getTrashedOrders(req.auth!.sub, dukandarId as string | undefined);
            res.status(200).json({ success: true, data: orders });
        }
    ),
};
