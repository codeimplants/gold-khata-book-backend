import { Types } from "mongoose";
import { InvoiceModel } from "./invoice.model";
import type {
  CreateInvoiceDTO,
  UpdateInvoiceDTO,
  InvoiceItem,
} from "./invoice.types";
import { AppError } from "../../common/errors/AppError";
import { CustomerModel } from "../customer/customer.model";
import { CustomerService } from "../customer/customer.service";
import { ItemModel } from "../item/item.model";
import { ShopDetail } from "../shopDetail/shopDetails.model";
import { getNextSequence } from "../../common/utils/counter.util";
import { splitGstAmount, DEFAULT_HSN_CODE } from "./invoice.gst";
import { uploadOrnamentPhoto, deleteImageByFileId } from "../../common/utils/imageKit";
import { deletePhotoIfUnreferenced, collectPhotoFileIds, releasePhotos } from "../../common/utils/photoReferences";
import { InvoiceService as SelfInvoiceService } from "../invoice/invoice.service"; // Renamed to avoid conflict
import mongoose from "mongoose";

const DEFAULT_GST_RATE = 0.03;

/** Mirrors the limit on Order and PurchaseOldGold — same ornaments, same cap. */
const MAX_ORNAMENT_PHOTOS = 6;
/** Per item, not per bill — a four-item invoice can hold 16 item photos. */
const MAX_ITEM_PHOTOS = 4;

export const InvoiceService = {
  /**
   * @param resolvedGstRate percent, already resolved from the payload, the
   *   shop setting or the default - the caller owns that lookup because it
   *   needs the shop, and this stays a pure calculation over the payload.
   */
  calculateInvoiceDetails(payload: CreateInvoiceDTO, resolvedGstRate = DEFAULT_GST_RATE * 100) {
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      throw new AppError("At least one item is required", {
        statusCode: 400,
        code: "VALIDATION_ERROR",
      });
    }

    const normalizedItems: InvoiceItem[] = payload.items.map((item) => {
      const grossWeight = Number(item.grossWeight);
      const lessWeight = Number(item.lessWeight);

      if (!Number.isFinite(grossWeight) || !Number.isFinite(lessWeight)) {
        throw new AppError("All weight fields must be numeric values", {
          statusCode: 400,
          code: "VALIDATION_ERROR",
        });
      }

      const netWeight = grossWeight - lessWeight;

      return {
        ...item,
        grossWeight,
        lessWeight,
        netWeight,
      };
    });

    const itemsTotal = normalizedItems.reduce((sum, item) => {
      const netWeight = item.netWeight;
      const grossWeight = Number(item.grossWeight ?? netWeight);
      const rate = Number(item.rate);
      const makingCharge = Number(item.makingCharge ?? 0);
      const chargeAmount = Number(item.chargeAmount ?? 0);
      const discount = Number(item.discount ?? 0);

      // Metal is paid for by net weight — stones and beads are deducted.
      const weightAmount = netWeight * rate;

      // Making charge is labour on the whole piece, so it is billed on gross.
      //
      // This mirrors gold-khata-book-frontend/src/utils/calculations.ts exactly. The two
      // had disagreed: percentage was missing here entirely and fell through to
      // the flat branch, so "10%" was stored as ₹10, and per-gram was billed on
      // net where the app billed on gross. The app's figure is the one printed
      // on the bill and quoted to the customer, so it is the correct one.
      const makingType = item.makingType.toLowerCase();
      const making = ["pergram", "per gram"].includes(makingType)
        ? grossWeight * makingCharge
        : ["percent", "percentage", "%"].includes(makingType)
          ? (grossWeight * rate * makingCharge) / 100
          : makingCharge;

      const beforeDiscount = weightAmount + making + chargeAmount;

      const discountValue =
        ["percent", "percentage"].includes(item.discountType.toLowerCase())
          ? (beforeDiscount * discount) / 100
          : discount;

      const lineTotal = Math.max(beforeDiscount - discountValue, 0);

      return sum + lineTotal;
    }, 0);

    const subTotal = Math.max(itemsTotal, 0);

    // Derived here, not taken from the client.
    //
    // subTotal has always been computed server-side with each line's
    // discount applied, while gstAmount was whatever the client sent - and
    // the advance-settlement screen sent GST on the pre-discount figure.
    // ADV-80 stored subTotal 244,957 with GST 7,354.71, which is 3% of
    // 245,157: a tax base that appears nowhere on the invoice. Two sources
    // for one number is the whole defect, so there is now one.
    //
    // Discount first, then GST on what remains: tax applies to the actual
    // transaction value once a trade discount shown on the invoice is
    // taken off.
    const gstAmount = payload.includeGST
      ? subTotal * (resolvedGstRate / 100)
      : 0;
    const totalAmount = subTotal + gstAmount;

    return { normalizedItems, subTotal, gstAmount, totalAmount };
  },

  async createInvoice(
    userId: string,
    customerId: string,
    payload: CreateInvoiceDTO,
    dukandarId?: string,
    session?: any
  ) {
    const customer = await CustomerModel.findOne({
      _id: customerId,
    });

    if (!customer) {
      throw new AppError("Customer not found", {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }

    // Resolved before the calculation, which now needs it: GST is derived
    // from the server-computed subTotal rather than trusted from the client.
    const shop = await ShopDetail.findOne({ userId }).lean();
    const gstRate = payload.gstRate ?? shop?.gstPercentage ?? DEFAULT_GST_RATE * 100;

    const { normalizedItems, subTotal, gstAmount, totalAmount } =
      this.calculateInvoiceDetails(payload, gstRate);

    const invoiceDate =
      payload.invoiceDate instanceof Date
        ? payload.invoiceDate
        : new Date(payload.invoiceDate);

    // Snapshot shop GSTIN at creation — shop settings are mutable and
    // historical GST reports must reflect what was actually charged. The
    // shop and the rate are resolved above, where the calculation needs them.
    const shopGstin = shop?.gstNo?.trim() ? shop.gstNo.trim().toUpperCase() : undefined;
    const customerGstin = payload.customerGstin?.trim()
      ? payload.customerGstin.trim().toUpperCase()
      : undefined;
    const gstSplit = payload.includeGST
      ? splitGstAmount(gstAmount, shopGstin, customerGstin)
      : undefined;

    const itemsWithHsn = normalizedItems.map((item) => ({
      ...item,
      hsnCode: item.hsnCode?.trim() || DEFAULT_HSN_CODE,
    }));

    const invoice = await InvoiceModel.create(
      [
        {
          userId: new Types.ObjectId(userId),
          customerId: new Types.ObjectId(customerId),
          dukandarId:
            dukandarId && Types.ObjectId.isValid(dukandarId)
              ? new Types.ObjectId(dukandarId)
              : undefined,
          orderId:
            payload.orderId && Types.ObjectId.isValid(payload.orderId)
              ? new Types.ObjectId(payload.orderId)
              : undefined,
          invoiceDate,
          invoiceNumber: payload.invoiceNumber,
          items: itemsWithHsn,
          includeGST: payload.includeGST,
          subTotal,
          gstAmount,
          totalAmount,
          gstRate,
          cgstAmount: gstSplit?.cgstAmount ?? 0,
          sgstAmount: gstSplit?.sgstAmount ?? 0,
          igstAmount: gstSplit?.igstAmount ?? 0,
          shopGstin,
          customerGstin,
          supplyType: gstSplit?.supplyType ?? "intra",
          placeOfSupply: gstSplit?.placeOfSupply,
          advancePayments: payload.payments || [],
          // Only ever populated by the advance-settlement path; absent on a
          // directly created invoice, which uploads its photos afterwards.
          ornamentPhotos: payload.ornamentPhotos?.length ? payload.ornamentPhotos : undefined,
          includeItemPhotosOnBill: payload.includeItemPhotosOnBill ?? false,
        },
      ],
      { session }
    );

    // Mongoose create with an array returns an array
    const createdInvoice = Array.isArray(invoice) ? invoice[0] : invoice;

    await CustomerService.attachInvoice(createdInvoice.customerId, createdInvoice._id);

    if (dukandarId && Types.ObjectId.isValid(dukandarId)) {
      const dukandarObjectId = new Types.ObjectId(dukandarId);

      const itemDocs = normalizedItems.map((p) => ({
        userId: new Types.ObjectId(userId),
        invoiceId: createdInvoice._id,
        customerId: createdInvoice.customerId,
        dukandarId: dukandarObjectId,
        name: p.name,
        huid: p.huid,
        pieces: p.pieces,
        itemType: p.itemType,
        purity: p.purity,
        grossWeight: p.grossWeight,
        lessWeight: p.lessWeight,
        netWeight: p.netWeight,
        rate: p.rate,
        makingType: p.makingType,
        makingCharge: p.makingCharge,
        chargeDescription: p.chargeDescription,
        chargeAmount: p.chargeAmount,
        discountType: p.discountType,
        discount: p.discount,
      }));

      await ItemModel.insertMany(itemDocs, { session });
    }

    return createdInvoice;
  },

  async getAllInvoices(userId: string, customerId?: string, dukandarId?: string) {
    const filter: any = {
      userId: new Types.ObjectId(userId),
      deletedAt: null,
    };

    if (customerId && Types.ObjectId.isValid(customerId)) {
      filter.customerId = new Types.ObjectId(customerId);
    }

    if (dukandarId && Types.ObjectId.isValid(dukandarId)) {
      filter.dukandarId = new Types.ObjectId(dukandarId);
    }

    const invoices = await InvoiceModel.find(filter)
      .populate("customerId")
      .populate("dukandarId")
      .sort({ createdAt: -1 });

    return invoices;
  },

  async getInvoiceById(userId: string, invoiceId: string, dukandarId?: string) {
    if (!Types.ObjectId.isValid(invoiceId)) {
      throw new AppError("Invalid invoice ID", {
        statusCode: 400,
        code: "VALIDATION_ERROR",
      });
    }

    const filter: any = {
      _id: new Types.ObjectId(invoiceId),
      userId: new Types.ObjectId(userId),
    };

    if (dukandarId && Types.ObjectId.isValid(dukandarId)) {
      filter.dukandarId = new Types.ObjectId(dukandarId);
    }

    const invoice = await InvoiceModel.findOne(filter)
      .populate("customerId")
      .populate("dukandarId");

    if (!invoice) {
      throw new AppError("Invoice not found", {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }

    return invoice;
  },

  async updateInvoice(
    userId: string,
    invoiceId: string,
    payload: UpdateInvoiceDTO,
    dukandarId?: string
  ) {
    if (!Types.ObjectId.isValid(invoiceId)) {
      throw new AppError("Invalid invoice ID", {
        statusCode: 400,
        code: "VALIDATION_ERROR",
      });
    }

    const filter: any = {
      _id: new Types.ObjectId(invoiceId),
      userId: new Types.ObjectId(userId),
    };

    if (dukandarId && Types.ObjectId.isValid(dukandarId)) {
      filter.dukandarId = new Types.ObjectId(dukandarId);
    }

    const existingInvoice = await InvoiceModel.findOne(filter);

    if (!existingInvoice) {
      throw new AppError("Invoice not found", {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }

    if (existingInvoice.deletedAt) {
      throw new AppError("Cannot edit a deleted invoice", {
        statusCode: 400,
        code: "VALIDATION_ERROR",
      });
    }

    let normalizedItems: InvoiceItem[] | undefined;
    if (payload.items) {
      if (!Array.isArray(payload.items) || payload.items.length === 0) {
        throw new AppError("At least one item is required", {
          statusCode: 400,
          code: "VALIDATION_ERROR",
        });
      }

      normalizedItems = payload.items.map((item) => {
        const grossWeight = Number(item.grossWeight);
        const lessWeight = Number(item.lessWeight);

        if (!Number.isFinite(grossWeight) || !Number.isFinite(lessWeight)) {
          throw new AppError("All weight fields must be numeric values", {
            statusCode: 400,
            code: "VALIDATION_ERROR",
          });
        }

        const netWeight = grossWeight - lessWeight;

        return {
          ...item,
          grossWeight,
          lessWeight,
          netWeight,
        };
      });
    }

    // Item photos live on the item and are uploaded separately, so an edit that
    // resends the item list (which the app always does) would otherwise drop
    // them — the shopkeeper's photos would vanish on an unrelated price fix.
    // Carried across by position, the same handle the upload route uses; a
    // resent item may legitimately carry its own photos, which win.
    if (normalizedItems) {
      normalizedItems = normalizedItems.map((item: any, index: number) => {
        if (item.photos !== undefined) return item;
        const previous = (existingInvoice.items || [])[index] as any;
        return previous?.photos?.length ? { ...item, photos: previous.photos } : item;
      });
    }

    const itemsToUse = normalizedItems || existingInvoice.items;
    const includeGST =
      payload.includeGST !== undefined ? payload.includeGST : existingInvoice.includeGST;

    const itemsTotal = itemsToUse.reduce((sum, item) => {
      const netWeight = item.netWeight;
      const grossWeight = Number(item.grossWeight ?? netWeight);
      const rate = Number(item.rate);
      const makingCharge = Number(item.makingCharge ?? 0);
      const chargeAmount = Number(item.chargeAmount ?? 0);
      const discount = Number(item.discount ?? 0);

      const weightAmount = netWeight * rate;

      // Same rule as the create path above — kept in step deliberately, since
      // an edit that recalculated differently would silently change the total
      // of an already-issued bill.
      const makingType = item.makingType.toLowerCase();
      const making = ["pergram", "per gram"].includes(makingType)
        ? grossWeight * makingCharge
        : ["percent", "percentage", "%"].includes(makingType)
          ? (grossWeight * rate * makingCharge) / 100
          : makingCharge;

      const beforeDiscount = weightAmount + making + chargeAmount;

      const discountValue =
        ["percent", "percentage"].includes(item.discountType.toLowerCase())
          ? (beforeDiscount * discount) / 100
          : discount;

      const lineTotal = Math.max(beforeDiscount - discountValue, 0);

      return sum + lineTotal;
    }, 0);

    const subTotal = Math.max(itemsTotal, 0);
    // Same rule as creation: derived from the recomputed subTotal, not
    // taken from the client. An edit that changed an item discount would
    // otherwise move subTotal and leave the tax on it untouched.
    const effectiveGstRate = payload.gstRate ?? existingInvoice.gstRate ?? DEFAULT_GST_RATE * 100;
    const gstAmount = includeGST ? subTotal * (effectiveGstRate / 100) : 0;
    const totalAmount = subTotal + gstAmount;

    const invoiceDate = payload.invoiceDate
      ? payload.invoiceDate instanceof Date
        ? payload.invoiceDate
        : new Date(payload.invoiceDate)
      : existingInvoice.invoiceDate;

    // Re-derive the CGST/SGST/IGST split from the (possibly changed) GST
    // inputs while preserving creation-time snapshots (shopGstin, gstRate).
    const customerGstin =
      payload.customerGstin !== undefined
        ? payload.customerGstin.trim()
          ? payload.customerGstin.trim().toUpperCase()
          : undefined
        : existingInvoice.customerGstin;
    const gstSplit = includeGST
      ? splitGstAmount(gstAmount, existingInvoice.shopGstin, customerGstin)
      : undefined;

    const updateData: any = {
      invoiceDate,
      includeGST,
      subTotal,
      gstAmount,
      totalAmount,
      gstRate: payload.gstRate ?? existingInvoice.gstRate,
      cgstAmount: gstSplit?.cgstAmount ?? 0,
      sgstAmount: gstSplit?.sgstAmount ?? 0,
      igstAmount: gstSplit?.igstAmount ?? 0,
      // null (not undefined) so clearing the GSTIN actually unsets it —
      // Mongoose strips undefined values from update payloads.
      customerGstin: customerGstin ?? null,
      supplyType: gstSplit?.supplyType ?? "intra",
      placeOfSupply: gstSplit?.placeOfSupply ?? existingInvoice.placeOfSupply,
    };

    if (normalizedItems) {
      updateData.items = normalizedItems.map((item) => ({
        ...item,
        hsnCode: item.hsnCode?.trim() || DEFAULT_HSN_CODE,
      }));
    }

    if (payload.paymentMethod !== undefined) {
      updateData.paymentMethod = payload.paymentMethod;
      updateData.onlinePaymentType = payload.onlinePaymentType;
    }

    if (payload.includeItemPhotosOnBill !== undefined) {
      updateData.includeItemPhotosOnBill = payload.includeItemPhotosOnBill;
    }

    const updatedInvoice = await InvoiceModel.findByIdAndUpdate(invoiceId, updateData, {
      new: true,
      runValidators: true,
    })
      .populate("customerId")
      .populate("dukandarId");

    // The per-dukandar item ledger (ItemModel) is only ever written at
    // creation time (see createInvoice) and has no update path of its own —
    // on an item edit its rows would otherwise silently go stale/orphaned
    // relative to the invoice they're tied to. Replace them wholesale to
    // match whatever the invoice's items ended up being after this edit.
    if (normalizedItems && dukandarId && Types.ObjectId.isValid(dukandarId)) {
      const dukandarObjectId = new Types.ObjectId(dukandarId);
      await ItemModel.deleteMany({ invoiceId: new Types.ObjectId(invoiceId) });
      const itemDocs = normalizedItems.map((p) => ({
        userId: new Types.ObjectId(userId),
        invoiceId: new Types.ObjectId(invoiceId),
        customerId: existingInvoice.customerId,
        dukandarId: dukandarObjectId,
        name: p.name,
        huid: p.huid,
        pieces: p.pieces,
        itemType: p.itemType,
        purity: p.purity,
        grossWeight: p.grossWeight,
        lessWeight: p.lessWeight,
        netWeight: p.netWeight,
        rate: p.rate,
        makingType: p.makingType,
        makingCharge: p.makingCharge,
        chargeDescription: p.chargeDescription,
        chargeAmount: p.chargeAmount,
        discountType: p.discountType,
        discount: p.discount,
      }));
      await ItemModel.insertMany(itemDocs);
    }

    return updatedInvoice;
  },

  async deleteInvoice(userId: string, invoiceId: string, dukandarId?: string) {
    if (!Types.ObjectId.isValid(invoiceId)) {
      throw new AppError("Invalid invoice ID", {
        statusCode: 400,
        code: "VALIDATION_ERROR",
      });
    }

    const filter: any = {
      _id: new Types.ObjectId(invoiceId),
      userId: new Types.ObjectId(userId),
    };

    if (dukandarId && Types.ObjectId.isValid(dukandarId)) {
      filter.dukandarId = new Types.ObjectId(dukandarId);
    }

    const invoice = await InvoiceModel.findOne(filter);

    if (!invoice) {
      throw new AppError("Invoice not found", {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }

    // Read before the row goes, released after — while the invoice still
    // exists it is its own holder and nothing would ever be freed.
    const fileIds = collectPhotoFileIds(invoice.toObject ? invoice.toObject() : invoice);

    await ItemModel.deleteMany({ invoiceId: new Types.ObjectId(invoiceId) });
    await CustomerService.detachInvoice(invoice.customerId, invoice._id);
    await InvoiceModel.findByIdAndDelete(invoiceId);

    // Item photographs. Each is dropped only if nothing else still points at it.
    await releasePhotos(userId, fileIds);

    return invoice;
  },

  async trashInvoice(userId: string, invoiceId: string, dukandarId?: string) {
    if (!Types.ObjectId.isValid(invoiceId)) {
      throw new AppError("Invalid invoice ID", { statusCode: 400, code: "VALIDATION_ERROR" });
    }
    const filter: any = { _id: new Types.ObjectId(invoiceId), userId: new Types.ObjectId(userId) };
    if (dukandarId && Types.ObjectId.isValid(dukandarId)) {
      filter.dukandarId = new Types.ObjectId(dukandarId);
    }
    const invoice = await InvoiceModel.findOneAndUpdate(filter, { deletedAt: new Date() }, { new: true });
    if (!invoice) {
      throw new AppError("Invoice not found", { statusCode: 404, code: "NOT_FOUND" });
    }
    return invoice;
  },

  /**
   * Attaches photos of the old ornaments taken in against this invoice.
   *
   * A full-payment exchange creates an Invoice, an advance one creates an Order,
   * so each collection needs its own upload path — there is no single document
   * that covers both.
   */
  async addOrnamentPhotos(userId: string, invoiceId: string, files: any[]) {
    if (!Types.ObjectId.isValid(invoiceId)) return null;

    const invoice = await InvoiceModel.findOne({
      _id: new Types.ObjectId(invoiceId),
      userId: new Types.ObjectId(userId),
      deletedAt: null,
    });
    if (!invoice) return null;

    const existing = invoice.ornamentPhotos || [];
    const remaining = MAX_ORNAMENT_PHOTOS - existing.length;
    if (remaining <= 0) {
      throw new AppError(
        `An invoice can hold at most ${MAX_ORNAMENT_PHOTOS} ornament photos`,
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
        "invoices",
        invoice.invoiceNumber || String(invoice._id)
      );
      uploaded.push({ url: result.url, fileId: result.fileId });
    }

    // Atomic for the same reason as addItemPhotos above: this and the item
    // upload run concurrently, and whichever saved second used to fail its
    // __v check and lose its photos.
    const updatedInvoice = await InvoiceModel.findOneAndUpdate(
      { _id: invoice._id, userId: new Types.ObjectId(userId), deletedAt: null },
      { $set: { ornamentPhotos: [...existing, ...uploaded] } },
      { new: true },
    );
    return updatedInvoice;
  },

  /**
   * Drops one ornament photo from an invoice. Mirrors
   * OrderService.removeOrnamentPhoto and PurchaseOldGoldService.removePhoto —
   * the remote delete is best-effort, since the database reference is what the
   * shopkeeper sees and an orphaned ImageKit file is invisible to them.
   */
  async removeOrnamentPhoto(userId: string, invoiceId: string, fileId: string) {
    if (!Types.ObjectId.isValid(invoiceId)) return null;

    const invoice = await InvoiceModel.findOne({
      _id: new Types.ObjectId(invoiceId),
      userId: new Types.ObjectId(userId),
      deletedAt: null,
    });
    if (!invoice) return null;

    const before = (invoice.ornamentPhotos || []).length;
    invoice.ornamentPhotos = (invoice.ornamentPhotos || []).filter(
      (p: any) => p.fileId !== fileId
    ) as any;
    if ((invoice.ornamentPhotos || []).length === before) {
      throw new AppError("Photo not found", {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }

    await invoice.save();
    await deletePhotoIfUnreferenced(userId, fileId);
    return invoice;
  },

  /**
   * Photos of one item SOLD on this invoice, addressed by the item's index.
   *
   * Index rather than id because invoice items carry `_id: false` — they are
   * value objects in a fixed order, the order the client sent and the order the
   * bill prints in. An out-of-range index is a 400, not a silent no-op: it means
   * the client and the stored invoice disagree about the item list, and
   * quietly attaching a photo to nothing would lose the shopkeeper's picture.
   */
  async addItemPhotos(
    userId: string,
    invoiceId: string,
    itemIndex: number,
    files: any[]
  ) {
    if (!Types.ObjectId.isValid(invoiceId)) return null;

    const invoice = await InvoiceModel.findOne({
      _id: new Types.ObjectId(invoiceId),
      userId: new Types.ObjectId(userId),
      deletedAt: null,
    });
    if (!invoice) return null;

    const item = (invoice.items || [])[itemIndex] as any;
    if (!Number.isInteger(itemIndex) || itemIndex < 0 || !item) {
      throw new AppError("Item not found on this invoice", {
        statusCode: 400,
        code: "BAD_REQUEST",
      });
    }

    const existing = item.photos || [];
    const remaining = MAX_ITEM_PHOTOS - existing.length;
    if (remaining <= 0) {
      throw new AppError(
        `An item can hold at most ${MAX_ITEM_PHOTOS} photos`,
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
        "invoices",
        invoice.invoiceNumber || String(invoice._id),
        `items/${itemIndex}`
      );
      uploaded.push({ url: result.url, fileId: result.fileId });
    }

    item.photos = [...existing, ...uploaded];
    // The array holds plain sub-objects, so mutating one in place is invisible
    // Written with an atomic $set on this one path rather than doc.save().
    //
    // save() on a document with a modified array carries Mongoose optimistic
    // concurrency: it matches on __v and bumps it. Photo uploads run
    // concurrently by design - CreateInvoiceScreen fires the ornament and the
    // item uploads together, each spending seconds in ImageKit before saving -
    // so both loaded at __v 0, the first commit bumped it, and the second died
    // with "No matching document found ... version 0". It surfaced as a 500 and
    // was invisible: the dispatch is fire-and-forget and nothing reads the
    // failed indices, so the shopkeeper just found photos missing later.
    // Observed on INV-7, INV-8 and an advance order on 2026-08-23.
    //
    // $set on the exact path needs no version guard, because two writers
    // touching different photo arrays are not actually in conflict.
    const nextPhotos = [...existing, ...uploaded];
    const updated = await InvoiceModel.findOneAndUpdate(
      { _id: invoice._id, userId: new Types.ObjectId(userId), deletedAt: null },
      { $set: { [`items.${itemIndex}.photos`]: nextPhotos } },
      { new: true },
    );
    return updated;
  },

  /** Mirrors removeOrnamentPhoto: the remote delete is best-effort, since the
   *  database reference is what the shopkeeper actually sees. */
  async removeItemPhoto(
    userId: string,
    invoiceId: string,
    itemIndex: number,
    fileId: string
  ) {
    if (!Types.ObjectId.isValid(invoiceId)) return null;

    const invoice = await InvoiceModel.findOne({
      _id: new Types.ObjectId(invoiceId),
      userId: new Types.ObjectId(userId),
      deletedAt: null,
    });
    if (!invoice) return null;

    const item = (invoice.items || [])[itemIndex] as any;
    if (!item) {
      throw new AppError("Item not found on this invoice", {
        statusCode: 400,
        code: "BAD_REQUEST",
      });
    }

    const before = (item.photos || []).length;
    item.photos = (item.photos || []).filter((p: any) => p.fileId !== fileId);
    if ((item.photos || []).length === before) {
      throw new AppError("Photo not found", { statusCode: 404, code: "NOT_FOUND" });
    }

    invoice.markModified("items");
    await invoice.save();
    await deletePhotoIfUnreferenced(userId, fileId);
    return invoice;
  },

  async restoreInvoice(userId: string, invoiceId: string, dukandarId?: string) {
    if (!Types.ObjectId.isValid(invoiceId)) {
      throw new AppError("Invalid invoice ID", { statusCode: 400, code: "VALIDATION_ERROR" });
    }
    const filter: any = { _id: new Types.ObjectId(invoiceId), userId: new Types.ObjectId(userId) };
    if (dukandarId && Types.ObjectId.isValid(dukandarId)) {
      filter.dukandarId = new Types.ObjectId(dukandarId);
    }
    const invoice = await InvoiceModel.findOneAndUpdate(filter, { deletedAt: null }, { new: true });
    if (!invoice) {
      throw new AppError("Invoice not found", { statusCode: 404, code: "NOT_FOUND" });
    }
    return invoice;
  },

  async getTrashedInvoices(userId: string, dukandarId?: string) {
    const filter: any = { userId: new Types.ObjectId(userId), deletedAt: { $ne: null } };
    if (dukandarId && Types.ObjectId.isValid(dukandarId)) {
      filter.dukandarId = new Types.ObjectId(dukandarId);
    }
    return InvoiceModel.find(filter).populate("customerId").sort({ deletedAt: -1 });
  },

  async getNextInvoiceNumber(userId?: string, dukandarId?: string) {
    const id = userId || dukandarId || "global";
    const sequence = await getNextSequence(`invoice_${id}`);
    return `INV-${sequence}`;
  },
};