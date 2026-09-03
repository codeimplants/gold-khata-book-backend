import { Types } from "mongoose";

import { InvoiceModel } from "../../modules/invoice/invoice.model";
import { OrderModel } from "../../modules/order/order.model";
import { PurchaseOldGoldModel } from "../../modules/purchaseOldGold/purchaseOldGold.model";
import { deleteImageByFileId } from "./imageKit";

/**
 * Removes a photo from ImageKit, unless another record still points at it.
 *
 * Photographs became shared on 23 Aug 2026: a declaration written against an
 * exchange references the same files as the bill rather than copying them, so
 * one upload can be cited by two records. Deleting the file the moment either
 * record drops its reference would leave the other showing a broken image - and
 * one of the two is a signed legal record of what the shop took in.
 *
 * Callers must remove their own reference and save BEFORE calling this, which
 * every one of them already did: the search then sees only the *other*
 * holders, so "still referenced" is exactly "shared with something else".
 *
 * Scoped to the shop, and to the three collections that can hold a photo
 * reference. Missing one would mean deleting a file somebody still displays,
 * so if a new place starts storing photos it has to be added here - the same
 * standing obligation exportShopBeforeDelete carries.
 *
 * Never throws. A photo the database has already forgotten is gone from the
 * shopkeeper's point of view whatever ImageKit says, and a failed cleanup must
 * not turn a successful delete into an error.
 */
/**
 * Every ImageKit fileId a bill, order or declaration points at.
 *
 * One function for all three because they overlap: an invoice carries item
 * photos, bill-wide ornament photos and per-exchange-row photos, and a
 * declaration written against that exchange references the very same files
 * rather than copying them. Reading the shapes separately at each call site is
 * how one of them ends up forgotten.
 *
 * Used by the hard-delete paths, which must hand these to
 * deletePhotoIfUnreferenced AFTER the row is gone — while it still exists it is
 * its own holder, and nothing would ever be released.
 */
export const collectPhotoFileIds = (doc: any): string[] => {
  if (!doc) return [];
  const ids: (string | undefined)[] = [];
  const push = (photos: any) =>
    (photos || []).forEach((p: any) => ids.push(p?.fileId));

  push(doc.photos);              // declaration: bill-wide/ornament set
  push(doc.ornamentPhotos);      // invoice + order
  (doc.items || []).forEach((i: any) => push(i?.photos));
  (doc.ornamentExchanges || []).forEach((e: any) => push(e?.photos));
  (doc.witnesses || []).forEach((w: any) => push(w?.photos));
  (doc.idProofs || []).forEach((e: any) => push(e?.photos));

  return [...new Set(ids.filter(Boolean) as string[])];
};

/**
 * Releases a set of photo references, deleting each file only if nothing else
 * still points at it. Order matters — call this after the owning rows are gone.
 */
export const releasePhotos = async (
  userId: string,
  fileIds: string[],
): Promise<void> => {
  for (const fileId of fileIds) {
    await deletePhotoIfUnreferenced(userId, fileId);
  }
};

export const deletePhotoIfUnreferenced = async (
  userId: string,
  fileId: string,
): Promise<void> => {
  if (!fileId) return;

  try {
    const uid = new Types.ObjectId(userId);

    const [onInvoice, onOrder, onDeclaration] = await Promise.all([
      InvoiceModel.exists({
        userId: uid,
        $or: [
          { "items.photos.fileId": fileId },
          { "ornamentPhotos.fileId": fileId },
          { "ornamentExchanges.photos.fileId": fileId },
        ],
      }),
      OrderModel.exists({
        userId: uid,
        $or: [
          { "items.photos.fileId": fileId },
          { "ornamentPhotos.fileId": fileId },
          { "ornamentExchanges.photos.fileId": fileId },
        ],
      }),
      PurchaseOldGoldModel.exists({
        userId: uid,
        $or: [
          { "photos.fileId": fileId },
          { "items.photos.fileId": fileId },
          { "witnesses.photos.fileId": fileId },
          // Added 26 Aug 2026. A declaration holds scans on its ID-proof
          // entries as well, and leaving them out of this check inverted the
          // whole point of it: a file referenced only by an ID proof looked
          // unreferenced, so releasing any other holder deleted a scan the
          // declaration still pointed at. That is the one place a broken image
          // matters most — the identity evidence on a signed legal record.
          { "idProofs.photos.fileId": fileId },
        ],
      }),
    ]);

    if (onInvoice || onOrder || onDeclaration) return;

    await deleteImageByFileId(fileId);
  } catch {
    // Same reasoning as deleteImageByFileId's own swallow: the stored reference
    // is what the shopkeeper sees, and it is already gone.
  }
};
