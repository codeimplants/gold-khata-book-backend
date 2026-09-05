import type { Request, Response } from "express";
import asyncHandler from "../../common/middlewares/asyncHandler.middleware";
import type { ApiResponse } from "../../common/types/api";
import { InvoiceService } from "./invoice.service";
import type { CreateInvoiceDTO, UpdateInvoiceDTO } from "./invoice.types";
import { AppError } from "../../common/errors/AppError";
import { createInvoiceSchema } from "./invoice.schema";

export const InvoiceController = {
  createInvoice: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const validated = createInvoiceSchema.parse(req.body);
      const { customerId, dukandarId, ...rest } = validated;
      const payload = rest as any as CreateInvoiceDTO;
      const invoice = await InvoiceService.createInvoice(
        req.auth!.sub,
        customerId,
        payload,
        dukandarId
      );

      res.status(201).json({
        success: true,
        data: invoice,
        message: "Invoice created successfully",
      });
    }
  ),

  getAllInvoices: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const { customerId } = req.params;
      const { dukandarId } = req.query;

      const invoices = await InvoiceService.getAllInvoices(
        req.auth!.sub,
        customerId,
        dukandarId as string | undefined
      );

      res.status(200).json({
        success: true,
        data: invoices,
      });
    }
  ),

  getInvoiceById: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const { id } = req.params;
      const { dukandarId } = req.query;

      const invoice = await InvoiceService.getInvoiceById(
        req.auth!.sub,
        id,
        dukandarId as string | undefined
      );

      res.status(200).json({
        success: true,
        data: invoice,
      });
    }
  ),

  updateInvoice: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const { id } = req.params;
      const validated = createInvoiceSchema.partial().parse(req.body);
      const { dukandarId, ...rest } = validated;
      const payload = rest as any as UpdateInvoiceDTO;

      const invoice = await InvoiceService.updateInvoice(
        req.auth!.sub,
        id,
        payload,
        dukandarId
      );

      res.status(200).json({
        success: true,
        data: invoice,
        message: "Invoice updated successfully",
      });
    }
  ),

  deleteInvoice: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const { id } = req.params;
      const { dukandarId } = req.query;

      await InvoiceService.deleteInvoice(
        req.auth!.sub,
        id,
        dukandarId as string | undefined
      );

      res.status(200).json({
        success: true,
        data: null,
        message: "Invoice deleted successfully",
      });
    }
  ),

  trashInvoice: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const { id } = req.params;
      const { dukandarId } = req.query;
      const invoice = await InvoiceService.trashInvoice(req.auth!.sub, id, dukandarId as string | undefined);
      res.status(200).json({ success: true, data: invoice, message: "Invoice moved to trash" });
    }
  ),

  restoreInvoice: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const { id } = req.params;
      const { dukandarId } = req.query;
      const invoice = await InvoiceService.restoreInvoice(req.auth!.sub, id, dukandarId as string | undefined);
      res.status(200).json({ success: true, data: invoice, message: "Invoice restored" });
    }
  ),

  /**
   * Attaches photos of the old ornaments taken in against this invoice.
   * Non-fatal on the client: the invoice is already saved and printable, so a
   * failure here must never read as "the bill did not save".
   */
  addOrnamentPhotos: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const files = (req.files as any[]) || [];
      if (files.length === 0) {
        throw new AppError("No photos uploaded", {
          statusCode: 400,
          code: "BAD_REQUEST",
        });
      }
      const invoice = await InvoiceService.addOrnamentPhotos(
        req.auth!.sub,
        req.params.id,
        files
      );
      if (!invoice) {
        throw new AppError("Invoice not found", {
          statusCode: 404,
          code: "NOT_FOUND",
        });
      }
      res.status(200).json({ success: true, data: invoice, message: "Photos added" });
    }
  ),

  removeOrnamentPhoto: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const invoice = await InvoiceService.removeOrnamentPhoto(
        req.auth!.sub,
        req.params.id,
        req.params.fileId
      );
      if (!invoice) {
        throw new AppError("Invoice not found", {
          statusCode: 404,
          code: "NOT_FOUND",
        });
      }
      res.status(200).json({ success: true, data: invoice, message: "Photo removed" });
    }
  ),

  addItemPhotos: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const files = (req.files as any[]) || [];
      if (files.length === 0) {
        throw new AppError("No photos uploaded", {
          statusCode: 400,
          code: "BAD_REQUEST",
        });
      }
      const invoice = await InvoiceService.addItemPhotos(
        req.auth!.sub,
        req.params.id,
        Number(req.params.itemIndex),
        files
      );
      if (!invoice) {
        throw new AppError("Invoice not found", {
          statusCode: 404,
          code: "NOT_FOUND",
        });
      }
      res.status(200).json({ success: true, data: invoice, message: "Photos added" });
    }
  ),

  removeItemPhoto: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const invoice = await InvoiceService.removeItemPhoto(
        req.auth!.sub,
        req.params.id,
        Number(req.params.itemIndex),
        req.params.fileId
      );
      if (!invoice) {
        throw new AppError("Invoice not found", {
          statusCode: 404,
          code: "NOT_FOUND",
        });
      }
      res.status(200).json({ success: true, data: invoice, message: "Photo removed" });
    }
  ),

  getTrashedInvoices: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const { dukandarId } = req.query;
      const invoices = await InvoiceService.getTrashedInvoices(req.auth!.sub, dukandarId as string | undefined);
      res.status(200).json({ success: true, data: invoices });
    }
  ),

  getNextInvoiceNumber: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const { dukandarId, userId } = req.query;

      // Use authenticated user ID if available, otherwise use query param
      const effectiveUserId = req.auth?.sub || (userId as string);

      const nextNumber = await InvoiceService.getNextInvoiceNumber(
        effectiveUserId,
        dukandarId as string | undefined
      );

      res.status(200).json({
        success: true,
        data: { invoiceNumber: nextNumber },
      });
    }
  ),
};

