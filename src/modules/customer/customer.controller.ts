import { Request, Response } from "express";
import asyncHandler from "../../common/middlewares/asyncHandler.middleware";
import { CustomerService } from "./customer.service";
import { CreateCustomerDTO, UpdateCustomerDTO } from "./customer.types";
import { createCustomerSchema, updateCustomerSchema } from "./customer.schema";
import { AppError } from "../../common/errors/AppError";
import type { ApiResponse } from "../../common/types/api";
import { requireAdmin } from "../../common/middlewares/requireAdmin.middleware";
import { CustomerModel } from "./customer.model";

export const CustomerController = {
  createCustomer: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      try {
        const payload = createCustomerSchema.parse(req.body);
        const dukandarId = req.auth!.sub;
        const role = req.auth!.role;

        console.log(`[CustomerController] Create: role=${role}, sub=${dukandarId}, phone=${payload.phone}`);

        // Prevent creating customer with same phone as logged-in user or shop
        let userPhone = "";
        let shopPhone = "";
        
        if (role === 'admin') {
            const Admin = (await import("../admin/admin.model")).default;
            const admin = await Admin.findById(dukandarId);
            if (admin) userPhone = String(admin.phone).trim();
        } else if (role === 'dukandar') {
            const { Dukandar } = await import("../dukandar/dukandar.model");
            const dukandar = await Dukandar.findById(dukandarId).populate("shopDetails");
            if (dukandar) {
                userPhone = String(dukandar.phone).trim();
                const shop: any = dukandar.shopDetails;
                if (shop && shop.phone) {
                    shopPhone = String(shop.phone).trim();
                }
            }
        } else if (role === 'customer') {
            const customer = await CustomerModel.findById(dukandarId);
            if (customer) userPhone = String(customer.phone).trim();
        }

        // Both checks below are keyed on the phone number, so both are skipped
        // when there isn't one. Without the guard the first phoneless customer
        // would match every subsequent `{ phone: undefined }` lookup and block
        // the whole shop from adding a second one.
        const payloadPhone = payload.phone ? String(payload.phone).trim() : "";
        console.log(`[CustomerController] Validation: userPhone=${userPhone}, shopPhone=${shopPhone}, payloadPhone=${payloadPhone || "(none)"}`);

        if (payloadPhone) {
            if ((userPhone && userPhone === payloadPhone) || (shopPhone && shopPhone === payloadPhone)) {
                const msg = (shopPhone && shopPhone === payloadPhone)
                    ? "You cannot create a customer with your shop's phone number"
                    : "You cannot create a customer with your own registered mobile number";

                throw new AppError(msg, {
                    statusCode: 400,
                    code: "BAD_REQUEST",
                });
            }

            // Prevent duplicate customer for this dukandar. A phoneless customer
            // has no equivalent check — the app warns on a matching name instead,
            // which is advisory, not a block.
            const existingCustomer = await CustomerModel.findOne({
                phone: payloadPhone,
                dukandarId
            });

            if (existingCustomer) {
                throw new AppError("A customer with this phone number already exists in your list", {
                    statusCode: 409,
                    code: "CONFLICT",
                });
            }
        }

        const customer = await CustomerService.createCustomer(
          dukandarId,
          payload
        );

        res.status(201).json({
          success: true,
          data: customer,
          message: "Customer created successfully",
        });
      } catch (error: any) {
        if (error.code === 11000) {
          throw new AppError("Duplicate customer entry exists", {
            statusCode: 409,
            code: "CONFLICT",
            details: error.keyValue,
          });
        }
        throw error;
      }
    }
  ),

  getAllCustomers: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const dukandarId = req.auth!.sub;
      let customers = await CustomerService.getAllCustomers(dukandarId);

      // Filter out customer record with same phone as logged-in Dukandar.
      // Only meaningful when both sides actually have a number: comparing the
      // stringified values would otherwise match "undefined" to "undefined" and
      // hide every phoneless customer from a shop whose own number is unset.
      const { Dukandar } = await import("../dukandar/dukandar.model");
      const dukandar = await Dukandar.findById(dukandarId);
      if (dukandar?.phone) {
        customers = customers.filter(c => !c.phone || String(c.phone) !== String(dukandar.phone));
      }

      res.status(200).json({
        success: true,
        data: customers,
      });
    }
  ),

  getCustomerById: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const customer = await CustomerService.getCustomerById(
        req.params.id,
        req.auth!.sub
      );

      if (!customer) {
        throw new AppError("Customer not found", {
          statusCode: 404,
          code: "NOT_FOUND",
        });
      }

      res.status(200).json({
        success: true,
        data: customer,
      });
    }
  ),

  updateCustomer: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      console.log(`[CustomerController] updateCustomer params.id: ${req.params.id}, req.body:`, JSON.stringify(req.body, null, 2));
      const payload = updateCustomerSchema.parse(req.body);
      const dukandarId = req.auth!.sub;

      // Same guard the create path has, and it earns its place here now that a
      // number can be added from the old-gold declaration flow rather than only
      // on the customer screen: the partial unique index would otherwise throw a
      // raw E11000 the app can only show as "something went wrong".
      //
      // Skipped for a blank (that clears the number) and for a customer already
      // on this number, so re-saving an unchanged phone is not a conflict.
      if (payload.phone) {
        const clash = await CustomerModel.findOne({
          phone: payload.phone,
          dukandarId,
          _id: { $ne: req.params.id },
        });
        if (clash) {
          throw new AppError(
            "A customer with this phone number already exists in your list",
            { statusCode: 409, code: "CONFLICT" }
          );
        }
      }

      const updated = await CustomerService.updateCustomer(
        req.params.id,
        dukandarId,
        payload
      );

      if (!updated) {
        throw new AppError("Customer not found", {
          statusCode: 404,
          code: "NOT_FOUND",
        });
      }

      res.status(200).json({
        success: true,
        data: updated,
        message: "Customer updated successfully",
      });
    }
  ),

  setProfilePhoto: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const file = (req as any).file;
      if (!file) {
        throw new AppError("No photo uploaded", {
          statusCode: 400,
          code: "BAD_REQUEST",
        });
      }

      const updated = await CustomerService.setProfilePhoto(
        req.auth!.sub,
        req.params.id,
        file
      );

      if (!updated) {
        throw new AppError("Customer not found", {
          statusCode: 404,
          code: "NOT_FOUND",
        });
      }

      res.status(200).json({
        success: true,
        data: updated,
        message: "Customer photo updated successfully",
      });
    }
  ),

  removeProfilePhoto: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const updated = await CustomerService.removeProfilePhoto(
        req.auth!.sub,
        req.params.id
      );

      if (!updated) {
        throw new AppError("Customer not found", {
          statusCode: 404,
          code: "NOT_FOUND",
        });
      }

      res.status(200).json({
        success: true,
        data: updated,
        message: "Customer photo removed successfully",
      });
    }
  ),

  deleteCustomer: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const deleted = await CustomerService.deleteCustomer(
        req.params.id,
        req.auth!.sub
      );

      if (!deleted) {
        throw new AppError("Customer not found", {
          statusCode: 404,
          code: "NOT_FOUND",
        });
      }

      res.status(200).json({
        success: true,
        data: null,
        message: "Customer deleted successfully",
      });
    }
  ),

  getCustomersByDukandarId: asyncHandler(
    async (req: Request, res: Response<ApiResponse<unknown>>) => {
      const { dukandarId } = req.params;
      const customers = await CustomerService.getAllCustomers(dukandarId);

      res.status(200).json({
        success: true,
        data: customers,
      });
    }
  ),
};
