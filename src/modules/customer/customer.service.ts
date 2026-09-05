import { CustomerModel } from "./customer.model";
import { CreateCustomerDTO, UpdateCustomerDTO } from "./customer.types";
import { InvoiceModel } from "../invoice/invoice.model";
import { OrderModel } from "../order/order.model";
import { ShopDetail } from "../shopDetail/shopDetails.model";
import {
  uploadCustomerPhoto,
  deleteCustomerPhoto,
  copyCustomerPhoto,
} from "../../common/utils/imageKit";
import { ItemModel } from "../item/item.model";
import { collectPhotoFileIds, releasePhotos } from "../../common/utils/photoReferences";
import { Types } from "mongoose";

const toOid = (id: string | Types.ObjectId) =>
  typeof id === "string" ? new Types.ObjectId(id) : id;

/**
 * The shop's phone number, which is what customer photo folders are keyed by.
 * Falls back to the shop's id so a shop that has not filled in its profile can
 * still attach photos — same convention and same fallback as the declaration
 * ornament photos.
 */
const resolveShopPhone = async (dukandarId: string): Promise<string> => {
  const shop = await ShopDetail.findOne({ userId: dukandarId }).lean();
  return (shop as any)?.phone ? String((shop as any).phone) : String(dukandarId);
};

/**
 * The folder segment a customer's photo is filed under.
 *
 * Normally the phone number, which is the whole point of the layout — a
 * shopkeeper can find a photo in ImageKit from the two numbers they already
 * know. A customer without one falls back to their id.
 *
 * This fallback is not cosmetic. The upload uses a fixed `profile.webp` with
 * `overwriteFile: true`, so every phoneless customer sharing one folder segment
 * would mean each new photo silently replacing the previous customer's, and
 * deleting any one of them taking the rest with it.
 */
const photoKey = (customer: { _id: Types.ObjectId; phone?: string }): string =>
  customer.phone ? String(customer.phone) : String(customer._id);

export const CustomerService = {
  async createCustomer(dukandarId: string, payload: CreateCustomerDTO) {
    return CustomerModel.create({
      ...payload,
      dukandarId,
    });
  },

  async getAllCustomers(dukandarId: string) {
    return CustomerModel.find({ dukandarId }).sort({ createdAt: -1 });
  },

  async getCustomerById(dukandarId: string, customerId: string) {
    return CustomerModel.findOne({
      _id: customerId,
      dukandarId,
    }).populate("invoices");
  },

  async updateCustomer(
    customerId: string,
    dukandarId: string,
    payload: UpdateCustomerDTO
  ) {
    // Read first so a phone change can be detected — the photo's ImageKit
    // folder is keyed on the old number and has to move with it.
    const before = await CustomerModel.findOne({ _id: customerId, dukandarId }).lean();

    // An explicit blank means "remove the number I entered by mistake", and has
    // to become a `$unset`: written through as `""` it would be a value under
    // the partial unique index, and the second customer cleared this way would
    // collide with the first.
    const { phone, ...rest } = payload;
    const update: Record<string, unknown> =
      phone === ""
        ? { $set: rest, $unset: { phone: "" } }
        : { $set: payload };

    const updated = await CustomerModel.findOneAndUpdate(
      { _id: customerId, dukandarId },
      update,
      // The Zod schema already caps lengths at the controller, but
      // findOneAndUpdate skips schema validators unless told to — belt and
      // braces so the model's maxlength is never silently bypassed.
      { new: true, runValidators: true }
    );

    if (!updated) return updated;

    // Both keys are resolved through `photoKey`, so this covers adding a number
    // to a phoneless customer (id folder → phone folder) and clearing one
    // (phone folder → id folder), not just swapping one number for another.
    const oldKey = before ? photoKey(before as any) : "";
    const newKey = photoKey(updated as any);
    const photoMoved =
      oldKey && newKey && oldKey !== newKey && before?.profilePhoto?.url;

    if (photoMoved) {
      // Copy → repoint → delete, in that order, so no failure between the steps
      // can leave a stored URL pointing at nothing:
      //
      //   copy fails       → nothing changed, old URLs still resolve
      //   repoint fails    → both copies exist, old URLs still resolve
      //   delete fails     → a duplicate file, invisible to the shopkeeper
      //
      // The whole block is best-effort: the name and phone edit is already
      // saved, and a photo problem must never fail an ordinary customer edit.
      try {
        const shopPhone = await resolveShopPhone(dukandarId);
        const newUrl = await copyCustomerPhoto(shopPhone, oldKey, newKey);

        // Null means nothing was at the old path — already moved by an earlier
        // attempt, or never uploaded. Nothing to repoint either way.
        if (newUrl) {
          updated.profilePhoto = {
            url: newUrl,
            fileId: updated.profilePhoto?.fileId || "",
          };
          await updated.save();

          // Only now that every reference has moved. Already non-fatal.
          await deleteCustomerPhoto(shopPhone, oldKey);
        }
      } catch (error) {
        // Both copies exist and every stored URL still resolves, so the photo
        // is intact — it is only filed under the old number until the next
        // successful edit. Logged rather than surfaced: the shopkeeper asked to
        // rename a customer, and that worked.
        console.error("Customer photo re-key failed:", error);
      }
    }

    return updated;
  },

  /**
   * Removes a customer and everything filed under them.
   *
   * This used to delete the customer row alone, which left their bills, orders
   * and old-gold declarations in the database pointing at an id that no longer
   * resolved — the Dashboard would keep counting purchases from a customer the
   * shopkeeper had already removed, and nothing in the app could reach those
   * records to clean them up.
   *
   * Irreversible, and it takes GST-relevant invoices with it. The app confirms
   * with a count of exactly what will go before calling this.
   *
   * The customer is deleted last: if a cascade step throws, the customer still
   * exists and the operation can be retried, rather than leaving the very
   * orphans this exists to prevent.
   */
  async deleteCustomer(customerId: string, dukandarId: string) {
    const customer = await CustomerModel.findOne({
      _id: customerId,
      dukandarId,
    });
    if (!customer) return null;

    const oid = toOid(customerId);
    const owner = toOid(dukandarId);

    // Read the whole set first: once the rows are gone their photo references
    // are gone with them, and the files would stay on ImageKit forever with
    // nothing left that names them. Declarations are included because this
    // path destroys them outright — unlike deleting a single bill, which
    // retires the declaration and deliberately keeps its evidence.
    const [doomedInvoices, doomedOrders] = await Promise.all([
      InvoiceModel.find({ customerId: oid, dukandarId: owner }).lean(),
      OrderModel.find({ customerId: oid, userId: owner }).lean(),
    ]);

    const fileIds = [
      ...new Set(
        [...doomedInvoices, ...doomedOrders].flatMap(collectPhotoFileIds),
      ),
    ];

    // Every filter re-asserts shop ownership. A customerId alone would be
    // enough to match, but never let one shop's delete reach another's rows.
    await Promise.all([
      InvoiceModel.deleteMany({ customerId: oid, dukandarId: owner }),
      OrderModel.deleteMany({ customerId: oid, userId: owner }),
      // The per-dukandar ledger rows for those bills. Deleting one invoice on
      // its own has always removed them (see deleteInvoice); this path used
      // deleteMany and skipped straight past that, so wiping a customer's
      // invoices left the ledger of them behind pointing at invoiceIds that no
      // longer resolved.
      ItemModel.deleteMany({
        invoiceId: { $in: doomedInvoices.map((i: any) => i._id) },
      }),
    ]);

    // Now that nothing references them, release the photographs of the
    // ornaments, items and ID documents those records carried.
    await releasePhotos(dukandarId, fileIds);

    // Their photo too, or ImageKit keeps a folder for a customer that no longer
    // exists. Non-fatal by design — a stranded image must not fail the delete.
    if (customer.profilePhoto) {
      const shopPhone = await resolveShopPhone(dukandarId);
      await deleteCustomerPhoto(shopPhone, photoKey(customer));
    }

    return CustomerModel.findOneAndDelete({ _id: customerId, dukandarId });
  },

  /**
   * Sets (or replaces) a customer's profile photo.
   *
   * Keyed on the customer's phone number (or id, when they have none) for the
   * folder path, so it must be read from the stored record rather than trusted
   * from the request.
   */
  async setProfilePhoto(dukandarId: string, customerId: string, file: any) {
    if (!Types.ObjectId.isValid(customerId)) return null;

    const customer = await CustomerModel.findOne({
      _id: customerId,
      dukandarId,
    });
    if (!customer) return null;

    const shopPhone = await resolveShopPhone(dukandarId);
    const uploaded = await uploadCustomerPhoto(file, shopPhone, photoKey(customer));

    customer.profilePhoto = { url: uploaded.url, fileId: uploaded.fileId };
    await customer.save();
    return customer;
  },

  async removeProfilePhoto(dukandarId: string, customerId: string) {
    if (!Types.ObjectId.isValid(customerId)) return null;

    const customer = await CustomerModel.findOne({
      _id: customerId,
      dukandarId,
    });
    if (!customer) return null;

    if (customer.profilePhoto) {
      const shopPhone = await resolveShopPhone(dukandarId);
      await deleteCustomerPhoto(shopPhone, photoKey(customer));
    }

    customer.profilePhoto = undefined;
    await customer.save();
    return customer;
  },

  async deleteAllForDukandar(dukandarId: string | Types.ObjectId) {
    return CustomerModel.deleteMany({ dukandarId });
  },

  // called from Bill service
  async attachInvoice(customerId: Types.ObjectId, billId: Types.ObjectId) {
    return CustomerModel.findByIdAndUpdate(
      customerId,
      { $push: { invoices: billId } },
      { new: true }
    );
  },

  async detachInvoice(customerId: Types.ObjectId, billId: Types.ObjectId) {
    return CustomerModel.findByIdAndUpdate(
      customerId,
      { $pull: { invoices: billId } },
      { new: true }
    );
  },
};
