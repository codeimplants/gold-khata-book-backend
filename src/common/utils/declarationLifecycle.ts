import { Types } from "mongoose";

import { PurchaseOldGoldModel } from "../../modules/purchaseOldGold/purchaseOldGold.model";

/**
 * Retires the declaration attached to a bill that is being permanently deleted.
 *
 * Soft, never hard: a signed declaration is the shop's legal record of who sold
 * them gold, so it stays in the database exactly as `PurchaseOldGoldService.remove`
 * leaves one the shopkeeper deletes directly. What it must not do is stay
 * *live*, because a live declaration whose bill no longer exists is reachable
 * from nowhere at all — the order detail screen is gone, and Sold to Us lists
 * standalone purchases only. It would sit in the collection counting towards
 * nothing and openable by no one.
 *
 * That state already existed in production before this ran: one declaration
 * written on 8 Aug 2026 points at an order id that no longer resolves, because
 * permanently deleting a bill removed the invoice and its items and left the
 * declaration behind. This is what stops more being made.
 *
 * Trashing a bill deliberately does NOT come through here. That is a 30-day
 * recycle bin, the bill can come back, and its declaration has to be waiting
 * when it does.
 *
 * Never throws. A declaration that cannot be retired must not turn a successful
 * delete into an error — the same contract `deletePhotoIfUnreferenced` keeps.
 */
export const retireDeclarationFor = async (
  userId: string | Types.ObjectId,
  orderId: string | Types.ObjectId,
): Promise<void> => {
  try {
    await PurchaseOldGoldModel.updateMany(
      {
        userId: new Types.ObjectId(String(userId)),
        orderId: new Types.ObjectId(String(orderId)),
        deletedAt: null,
      },
      { deletedAt: new Date() },
    );
  } catch {
    // Swallowed on purpose — see the note above.
  }
};
