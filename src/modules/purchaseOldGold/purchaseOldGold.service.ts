import { Types } from "mongoose";
import { PurchaseOldGoldModel } from "./purchaseOldGold.model";
import type {
  CreatePurchaseOldGoldDTO,
  UpdatePurchaseOldGoldDTO,
  ListPurchaseOldGoldFilters,
  DeclarationItem,
  DeclarationPhoto,
  IdProofEntry,
  Witness,
} from "./purchaseOldGold.types";
import { CustomerModel } from "../customer/customer.model";
import { ShopDetail } from "../shopDetail/shopDetails.model";
import {
  uploadOrnamentPhoto,
  deleteImageByFileId,
} from "../../common/utils/imageKit";
import { deletePhotoIfUnreferenced } from "../../common/utils/photoReferences";
import { AppError } from "../../common/errors/AppError";
import { InvoiceModel } from "../invoice/invoice.model";
import { OrderModel } from "../order/order.model";

/** Max photos per declaration — mirrored by the multer array limit on the route. */
export const MAX_DECLARATION_PHOTOS = 6;

/**
 * Max ID-proof photos per witness — front and back of one card. Separate
 * budget from MAX_DECLARATION_PHOTOS: ornament photos and witness ID are
 * different evidence and one should not crowd out the other.
 */
export const MAX_WITNESS_PHOTOS = 2;

/**
 * Max photos per ornament. Its own budget again: a declaration covering six
 * bangles should be able to photograph each one, so this cannot come out of
 * MAX_DECLARATION_PHOTOS. Matches MAX_ITEM_PHOTOS on the invoice side, which
 * answers the same question about a single piece.
 */
export const MAX_ITEM_PHOTOS = 4;

/**
 * Max photos per ID document — front and back of one card, same shape as the
 * witness budget and for the same reason: this is a scan of one card, not a
 * gallery. Each document gets its own budget so a customer producing an Aadhaar
 * and a PAN can photograph both.
 */
export const MAX_ID_PROOF_PHOTOS = 2;

const toOid = (id: string) => new Types.ObjectId(id);

const cleanText = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/** Opaque key, only ever compared for equality. ObjectId avoids a new dep. */
const newWitnessId = () => new Types.ObjectId().toString();

/** Same contract as newWitnessId, for ornaments. */
const newItemId = () => new Types.ObjectId().toString();

/** Same contract again, for ID documents. */
const newIdProofId = () => new Types.ObjectId().toString();

/**
 * Reconciles an incoming ID-proof array against what is already stored.
 *
 * The witness contract exactly: photos are never accepted from the client body,
 * so a document that survives an edit must have its stored scans carried across
 * by id. A missing id, an id matching nothing, or the same id twice all get a
 * fresh id and start empty — worst case a scan has to be re-attached, rather
 * than one customer's Aadhaar being filed under their PAN.
 *
 * Blank rows are dropped here rather than by the caller, since an ID with no
 * number records nothing.
 */
const reconcileIdProofs = (
  incoming: IdProofEntry[],
  stored: IdProofEntry[] = []
): IdProofEntry[] => {
  const previous = new Map(
    stored.filter((e) => e.id).map((e) => [e.id as string, e] as const)
  );
  const claimed = new Set<string>();

  return incoming
    .filter((e) => e.number?.trim())
    .map((entry) => {
      const candidate = entry.id?.trim();
      const id =
        candidate && !claimed.has(candidate) ? candidate : newIdProofId();
      claimed.add(id);
      return {
        id,
        type: entry.type,
        number: entry.number.trim(),
        otherLabel: cleanText(entry.otherLabel),
        photos: previous.get(id)?.photos || [],
      };
    });
};

/**
 * Reconciles an incoming ornament array against what is already stored.
 *
 * Exactly the witness contract, and for the same reason: photos are never
 * accepted from the client body, so an ornament that survives an edit must have
 * its stored set carried across by id. A missing id, an id matching nothing, or
 * the same id twice all get a fresh id and start empty — worst case a photo has
 * to be re-attached, rather than appearing against the wrong ornament.
 *
 * Unlike witnesses there is no name to filter on: an ornament is kept or not by
 * the caller, which already drops blank rows before sending.
 */
/**
 * Photo references an exchange already holds, keyed by row position.
 *
 * A declaration written against an exchange is a record of the same ornaments
 * that are on the bill, so it shows the same photographs. They are referenced,
 * not copied: one upload, one file, two records pointing at it.
 *
 * Read from the order or invoice here rather than accepted from the client,
 * which keeps the rule that photo references are never taken from a payload -
 * a caller cannot point a declaration at files that are not on the bill it
 * names.
 *
 * Matched by index because that is the only handle: buildExchangeDeclarationPrefill
 * builds the declaration items from the exchange rows in order, and exchange
 * rows carry no id server-side (mapOrnamentExchangesForApi whitelists fields
 * and drops the client one). Only valid at creation, which is the only place
 * it is used - an edit can reorder the list.
 */
const exchangePhotosByIndex = (
  source: any,
): { url: string; fileId: string }[][] => {
  if (!source) return [];
  return (source.ornamentExchanges || []).map(
    (row: any) => (row?.photos || []) as { url: string; fileId: string }[],
  );
};

/**
 * The bill an exchange declaration is written against.
 *
 * Looked up once and used for two things — the photographs above, and the
 * declaration's number below. It was two round trips to the same document
 * before the number needed it too.
 *
 * An invoice first, then an order: a full-payment bill and an advance order are
 * separate collections but a declaration references either by the same
 * `orderId`, exactly as the client's own lookup does.
 */
const findExchangeSource = async (userId: string, orderId?: string) => {
  if (!orderId || !Types.ObjectId.isValid(orderId)) return null;
  const filter = { _id: toOid(orderId), userId: toOid(userId), deletedAt: null };
  return (
    (await InvoiceModel.findOne(filter).lean()) ||
    (await OrderModel.findOne(filter).lean())
  );
};

/**
 * The number an exchange declaration prints under, taken from its bill.
 *
 * Deliberately not a sequence. A declaration written against an exchange is not
 * a transaction of its own — the bill is the transaction, and this document is
 * evidence attached to it. Giving it `INV-49` rather than a `POG-n` says so on
 * the page, and lets a customer holding both match them by eye.
 *
 * It also stops exchanges consuming the shop's POG counter, which is what left
 * gaps in the standalone series: four shops in production had one before this.
 *
 * `invoiceNumber` before `orderNumber` because a completed advance order has
 * both — and reuses the same `ADV-n` for each (see order.service.ts), so either
 * field gives the same answer there.
 */
const billNumberOf = (source: any): string | undefined =>
  (source?.invoiceNumber || source?.orderNumber || undefined) as
    | string
    | undefined;
const reconcileItems = (
  incoming: DeclarationItem[],
  stored: DeclarationItem[] = []
): DeclarationItem[] => {
  const previous = new Map(
    stored.filter((i) => i.id).map((i) => [i.id as string, i] as const)
  );
  const claimed = new Set<string>();

  return incoming.map((item) => {
    const candidate = item.id?.trim();
    const id = candidate && !claimed.has(candidate) ? candidate : newItemId();
    claimed.add(id);
    return {
      ...item,
      id,
      photos: previous.get(id)?.photos || [],
    };
  });
};

/**
 * Reconciles an incoming witness array against what is already stored.
 *
 * Photos are never accepted from the client, so a witness that survives an
 * edit must have its stored set carried across by id. Anything else — a
 * missing id, an id that matches nothing, the same id sent twice — is given a
 * fresh id and starts empty, which is the safe direction: worst case a photo
 * has to be re-attached, rather than being shown against the wrong person.
 */

/** Puts row N's photos on ornament N, leaving an ornament that already has
 *  its own alone. */
const attachExchangePhotos = (
  items: DeclarationItem[],
  byIndex: { url: string; fileId: string }[][],
): DeclarationItem[] => {
  if (byIndex.length === 0) return items;
  return items.map((item, index) => {
    if ((item as any).photos?.length) return item;
    const photos = byIndex[index];
    return photos?.length ? { ...item, photos } : item;
  });
};
const reconcileWitnesses = (
  incoming: Witness[],
  stored: Witness[] = []
): Witness[] => {
  const previous = new Map(
    stored.filter((w) => w.id).map((w) => [w.id as string, w] as const)
  );
  const claimed = new Set<string>();

  return incoming
    .filter((w) => w.name?.trim())
    .map((w) => {
      // The client's own id is kept whenever it is usable: it uploads witness
      // photos addressed by the id it sent, so replacing it here would strand
      // them against a witness that no longer exists.
      const candidate = w.id?.trim();
      const id =
        candidate && !claimed.has(candidate) ? candidate : newWitnessId();
      claimed.add(id);
      return {
        id,
        name: w.name.trim(),
        phone: cleanText(w.phone),
        photos: previous.get(id)?.photos || [],
      };
    });
};

/**
 * The ImageKit folder is keyed by the shop's phone number (same convention as
 * the shop logo/signature uploads). Falls back to the userId so a shop that has
 * not yet filled in its profile can still attach photos.
 */
const resolveStorageKey = async (userId: string): Promise<string> => {
  // IShopDetail types userId as a string, so query with the raw id — same as
  // shopDetails.service.ts does.
  const shop = await ShopDetail.findOne({ userId }).lean();
  return shop?.phone ? String(shop.phone) : userId;
};

export const PurchaseOldGoldService = {
  async list(userId: string, filters: ListPurchaseOldGoldFilters = {}) {
    const query: Record<string, unknown> = {
      userId: toOid(userId),
      deletedAt: null,
    };

    if (filters.customerId && Types.ObjectId.isValid(filters.customerId)) {
      query.customerId = toOid(filters.customerId);
    }
    if (filters.mode) {
      query.mode = filters.mode;
    }
    if (filters.from || filters.to) {
      const range: Record<string, Date> = {};
      if (filters.from) range.$gte = filters.from;
      if (filters.to) range.$lte = filters.to;
      query.declarationDate = range;
    }

    return PurchaseOldGoldModel.find(query).sort({ createdAt: -1 }).lean();
  },

  async getById(userId: string, declarationId: string) {
    if (!Types.ObjectId.isValid(declarationId)) return null;
    return PurchaseOldGoldModel.findOne({
      _id: toOid(declarationId),
      userId: toOid(userId),
      deletedAt: null,
    }).lean();
  },

  async create(userId: string, payload: CreatePurchaseOldGoldDTO) {
    if (!Types.ObjectId.isValid(payload.customerId)) {
      throw new AppError("Invalid customer", {
        statusCode: 400,
        code: "BAD_REQUEST",
      });
    }

    // Scoped to this shop: a declaration must never be able to reference
    // another dukandar's customer.
    const customer = await CustomerModel.findOne({
      _id: toOid(payload.customerId),
      dukandarId: toOid(userId),
    }).lean();

    if (!customer) {
      throw new AppError("Customer not found", {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }

    // A customer's phone number is optional everywhere else in the app — a
    // walk-in buying a small item does not have to give one. A declaration is
    // the exception and keeps it required: it is the shop's legal record of who
    // sold them gold, and a seller with neither a number nor any other way to
    // be reached is not a record worth keeping. Checked here rather than left
    // to the snapshot's `required: true`, which would surface as a Mongoose
    // ValidationError the app can only show as "something went wrong".
    if (!customer.phone) {
      throw new AppError(
        "Add a phone number for this customer before creating a declaration",
        {
          statusCode: 400,
          code: "BAD_REQUEST",
        }
      );
    }

    // The bill this is written against, read once for both the ornament
    // photographs and the declaration number. Null for a standalone purchase,
    // which has no bill and takes the next POG-n from the shop's counter.
    const exchangeSource =
      payload.mode === "exchange"
        ? await findExchangeSource(userId, payload.orderId)
        : null;

    if (payload.mode === "exchange" && !exchangeSource) {
      throw new AppError(
        "The bill this declaration belongs to could not be found",
        { statusCode: 404, code: "NOT_FOUND" }
      );
    }

    // One declaration per bill. Enforced by a unique index too, but caught here
    // so the shopkeeper gets a sentence they can act on instead of a raw
    // duplicate-key error. Reachable in practice: the app offers "generate
    // declaration" on the success screen and again on the order detail screen,
    // and tapping both before the first save lands would otherwise leave two
    // records against one bill — with the second invisible, since every reader
    // looks the declaration up by orderId and takes the first hit.
    if (exchangeSource) {
      const already = await PurchaseOldGoldModel.exists({
        userId: toOid(userId),
        orderId: toOid(payload.orderId as string),
        deletedAt: null,
      });
      if (already) {
        throw new AppError(
          "This bill already has a declaration. Edit the existing one instead.",
          { statusCode: 409, code: "CONFLICT" }
        );
      }
    }

    // Totals are derived in the model's pre-validate hook, not taken from here.
    return PurchaseOldGoldModel.create({
      // Absent for a standalone purchase, so the model's pre-save hook assigns
      // the next POG-n. Present for an exchange, so it does not.
      declarationNumber: billNumberOf(exchangeSource),
      userId: toOid(userId),
      customerId: toOid(payload.customerId),
      declarationDate:
        payload.declarationDate instanceof Date
          ? payload.declarationDate
          : new Date(payload.declarationDate),
      mode: payload.mode,
      language: payload.language,
      // Undefined leaves the schema default (true) to apply, which is what an
      // older client that never sends the field should get.
      includePhotosOnDeclaration: payload.includePhotosOnDeclaration,
      orderId:
        payload.orderId && Types.ObjectId.isValid(payload.orderId)
          ? toOid(payload.orderId)
          : undefined,

      customerSnapshot: {
        name: customer.name,
        phone: customer.phone,
        address: cleanText(customer.address),
        photoUrl: (customer as any).profilePhoto?.url,
      },

      ownerIsSelf: payload.ownerIsSelf,
      familyMemberName: cleanText(payload.familyMemberName),

      idProofType: payload.idProofType,
      idProofNumber: payload.idProofNumber.trim(),
      idProofOtherLabel: cleanText(payload.idProofOtherLabel),
      // Derive the array when an older client sends only the singular fields,
      // so every declaration written from here on has a consistent shape.
      // Reconciled rather than assigned so every entry lands with an id, which
      // is what the scans of it are addressed by.
      idProofs: reconcileIdProofs(
        payload.idProofs?.length
          ? payload.idProofs
          : [
              {
                type: payload.idProofType,
                number: payload.idProofNumber.trim(),
                otherLabel: cleanText(payload.idProofOtherLabel),
              },
            ]
      ),

      hasPurchaseReceipt: payload.hasPurchaseReceipt,
      purchaseReceiptDetails: cleanText(payload.purchaseReceiptDetails),
      noReceiptReason: cleanText(payload.noReceiptReason),

      // Carries the exchange's photographs onto the ornaments they are of.
      // Without this a declaration generated from an exchange arrived with
      // none: the prefill seeded it from the bill-wide set, which is empty on
      // anything created since photos moved onto the rows.
      items: attachExchangePhotos(
        reconcileItems(payload.items || []),
        exchangePhotosByIndex(exchangeSource),
      ),
      payout: payload.payout,
      witnesses: reconcileWitnesses(payload.witnesses || []),

      customerSignature: payload.customerSignature,
      // Stamped here rather than trusted from the client: the signing time on a
      // legal record should come from the server, and a device with a wrong
      // clock would otherwise date the declaration wrongly. Only set when there
      // is actually a signature, so an unsigned declaration carries no time.
      customerSignedAt: payload.customerSignature ? new Date() : undefined,

      photos: [],
    });
  },

  async update(
    userId: string,
    declarationId: string,
    payload: UpdatePurchaseOldGoldDTO
  ) {
    if (!Types.ObjectId.isValid(declarationId)) return null;

    const existing = await PurchaseOldGoldModel.findOne({
      _id: toOid(declarationId),
      userId: toOid(userId),
      deletedAt: null,
    });
    if (!existing) return null;

    // Witnesses are reconciled rather than assigned: the client sends the array
    // without photos, so a plain assign would drop the ID proof of every
    // witness on any edit that touches the section.
    //
    // idProofs is pulled out for exactly the same reason: the scans of a
    // document live on its entry, and letting the generic assign below
    // overwrite the array would drop every one of them on any edit.
    //
    // customerSignedAt is pulled out for the same reason it is stamped rather
    // than read in create(): the signing time on a legal record is the server's
    // to set, and the generic assign below would otherwise let a client with a
    // wrong clock backdate it.
    // items is pulled out for the same reason as witnesses: the client sends
    // ornaments without photos, so letting the generic assign below overwrite
    // them would drop every ornament photo on any edit that touches the list.
    // mode and orderId are pulled out because declarationNumber is immutable
    // and is derived from them. A standalone record flipped to "exchange" would
    // keep its POG-n while claiming to belong to a bill; an exchange flipped
    // the other way would keep a bill number that no longer refers to anything,
    // and would leave a hole in the shop's POG series that nothing fills. What
    // a declaration is does not change on an edit — only what it says.
    const {
      witnesses,
      items,
      idProofs,
      mode: _mode,
      orderId: _orderId,
      customerSignedAt: _clientSignedAt,
      ...rest
    } = payload;

    // Assign-then-save rather than findOneAndUpdate: the pre-validate hook
    // recomputes totalGrams/totalAmount, and it only runs on a document save.
    Object.entries(rest).forEach(([key, value]) => {
      if (value !== undefined) {
        (existing as any)[key] = value;
      }
    });

    // Re-stamped whenever the signature itself changes, and cleared when it is
    // removed so a stale time can never outlive the signature it described.
    if (payload.customerSignature !== undefined) {
      existing.customerSignedAt = payload.customerSignature
        ? new Date()
        : undefined;
    }

    let orphanedFileIds: string[] = [];
    if (witnesses !== undefined) {
      const next = reconcileWitnesses(witnesses, existing.witnesses);
      const kept = new Set(next.map((w) => w.id));
      orphanedFileIds = (existing.witnesses || [])
        .filter((w) => !w.id || !kept.has(w.id))
        .flatMap((w) => (w.photos || []).map((p) => p.fileId));

      existing.witnesses = next as any;
      existing.markModified("witnesses");
    }

    if (items !== undefined) {
      const next = reconcileItems(items, existing.items);
      const kept = new Set(next.map((i) => i.id));
      // Photos of ornaments the edit removed. Collected here and deleted only
      // after the save, same as the witness ones.
      orphanedFileIds = [
        ...orphanedFileIds,
        ...(existing.items || [])
          .filter((i) => !i.id || !kept.has(i.id))
          .flatMap((i) => (i.photos || []).map((p) => p.fileId)),
      ];

      existing.items = next as any;
      existing.markModified("items");
    }

    if (idProofs !== undefined) {
      const next = reconcileIdProofs(idProofs, existing.idProofs);
      const kept = new Set(next.map((e) => e.id));
      // Scans of documents the edit removed, deleted after the save like the
      // rest.
      orphanedFileIds = [
        ...orphanedFileIds,
        ...(existing.idProofs || [])
          .filter((e) => !e.id || !kept.has(e.id))
          .flatMap((e) => (e.photos || []).map((p) => p.fileId)),
      ];

      existing.idProofs = next as any;
      existing.markModified("idProofs");
    }

    // customerSnapshot and declarationNumber are deliberately immutable —
    // a signed document's identity and its counterparty do not change.
    await existing.save();

    // Only after the save commits — a failed save must not have destroyed the
    // files the stored record still points at.
    for (const fileId of orphanedFileIds) {
      await deletePhotoIfUnreferenced(userId, fileId);
    }

    return existing.toObject();
  },

  /** Soft delete, matching Invoice/Order. A signed declaration is evidence. */
  async remove(userId: string, declarationId: string) {
    if (!Types.ObjectId.isValid(declarationId)) return null;
    return PurchaseOldGoldModel.findOneAndUpdate(
      { _id: toOid(declarationId), userId: toOid(userId), deletedAt: null },
      { deletedAt: new Date() },
      { new: true }
    ).lean();
  },

  async addPhotos(userId: string, declarationId: string, files: any[]) {
    if (!Types.ObjectId.isValid(declarationId)) return null;

    const declaration = await PurchaseOldGoldModel.findOne({
      _id: toOid(declarationId),
      userId: toOid(userId),
      deletedAt: null,
    });
    if (!declaration) return null;

    const remaining = MAX_DECLARATION_PHOTOS - declaration.photos.length;
    if (remaining <= 0) {
      throw new AppError(
        `A declaration can hold at most ${MAX_DECLARATION_PHOTOS} photos`,
        { statusCode: 400, code: "BAD_REQUEST" }
      );
    }

    const storageKey = await resolveStorageKey(userId);

    const uploaded: DeclarationPhoto[] = [];
    for (const file of files.slice(0, remaining)) {
      const result = await uploadOrnamentPhoto(
        file,
        storageKey,
        "purchase-old-gold",
        declaration.declarationNumber
      );
      uploaded.push({ url: result.url, fileId: result.fileId });
    }

    declaration.photos.push(...uploaded);
    await declaration.save();
    return declaration.toObject();
  },

  async removePhoto(userId: string, declarationId: string, fileId: string) {
    if (!Types.ObjectId.isValid(declarationId)) return null;

    const declaration = await PurchaseOldGoldModel.findOne({
      _id: toOid(declarationId),
      userId: toOid(userId),
      deletedAt: null,
    });
    if (!declaration) return null;

    const before = declaration.photos.length;
    declaration.photos = declaration.photos.filter((p) => p.fileId !== fileId);
    if (declaration.photos.length === before) {
      throw new AppError("Photo not found", {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }

    await declaration.save();
    // Best-effort remote cleanup — the DB reference is what the user sees, and
    // deleteImageByFileId already swallows its own failures.
    await deletePhotoIfUnreferenced(userId, fileId);
    return declaration.toObject();
  },

  async addItemPhotos(
    userId: string,
    declarationId: string,
    itemId: string,
    files: any[]
  ) {
    if (!Types.ObjectId.isValid(declarationId)) return null;

    const declaration = await PurchaseOldGoldModel.findOne({
      _id: toOid(declarationId),
      userId: toOid(userId),
      deletedAt: null,
    });
    if (!declaration) return null;

    const item = (declaration.items || []).find((i) => i.id === itemId);
    // An ornament recorded before ids existed has none, so it cannot be
    // addressed until the declaration is saved again and gets backfilled.
    if (!item) {
      throw new AppError("Ornament not found", {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }

    const current = item.photos || [];
    const remaining = MAX_ITEM_PHOTOS - current.length;
    if (remaining <= 0) {
      throw new AppError(
        `An ornament can hold at most ${MAX_ITEM_PHOTOS} photos`,
        { statusCode: 400, code: "BAD_REQUEST" }
      );
    }

    const storageKey = await resolveStorageKey(userId);

    const uploaded: DeclarationPhoto[] = [];
    for (const file of files.slice(0, remaining)) {
      // Foldered per ornament so the shop's storage stays navigable when a
      // declaration carries several pieces, each with its own photos.
      const result = await uploadOrnamentPhoto(
        file,
        storageKey,
        "purchase-old-gold",
        `${declaration.declarationNumber}/ornaments/${itemId}`
      );
      uploaded.push({ url: result.url, fileId: result.fileId });
    }

    item.photos = [...current, ...uploaded];
    declaration.markModified("items");
    await declaration.save();
    return declaration.toObject();
  },

  async removeItemPhoto(
    userId: string,
    declarationId: string,
    itemId: string,
    fileId: string
  ) {
    if (!Types.ObjectId.isValid(declarationId)) return null;

    const declaration = await PurchaseOldGoldModel.findOne({
      _id: toOid(declarationId),
      userId: toOid(userId),
      deletedAt: null,
    });
    if (!declaration) return null;

    const item = (declaration.items || []).find((i) => i.id === itemId);
    if (!item) {
      throw new AppError("Ornament not found", {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }

    const before = (item.photos || []).length;
    item.photos = (item.photos || []).filter((p) => p.fileId !== fileId);
    if (item.photos.length === before) {
      throw new AppError("Photo not found", {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }

    declaration.markModified("items");
    await declaration.save();
    await deletePhotoIfUnreferenced(userId, fileId);
    return declaration.toObject();
  },

  async addIdProofPhotos(
    userId: string,
    declarationId: string,
    idProofId: string,
    files: any[]
  ) {
    if (!Types.ObjectId.isValid(declarationId)) return null;

    const declaration = await PurchaseOldGoldModel.findOne({
      _id: toOid(declarationId),
      userId: toOid(userId),
      deletedAt: null,
    });
    if (!declaration) return null;

    const entry = (declaration.idProofs || []).find((e) => e.id === idProofId);
    // An ID recorded before ids existed has none, so it cannot be addressed
    // until the declaration is saved again and gets backfilled.
    if (!entry) {
      throw new AppError("ID proof not found", {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }

    const current = entry.photos || [];
    const remaining = MAX_ID_PROOF_PHOTOS - current.length;
    if (remaining <= 0) {
      throw new AppError(
        `An ID proof can hold at most ${MAX_ID_PROOF_PHOTOS} photos`,
        { statusCode: 400, code: "BAD_REQUEST" }
      );
    }

    const storageKey = await resolveStorageKey(userId);

    const uploaded: DeclarationPhoto[] = [];
    for (const file of files.slice(0, remaining)) {
      // Its own folder beside the witnesses', so a glance says which scans are
      // the seller's documents and which are somebody else's.
      const result = await uploadOrnamentPhoto(
        file,
        storageKey,
        "purchase-old-gold",
        `${declaration.declarationNumber}/id-proofs/${idProofId}`
      );
      uploaded.push({ url: result.url, fileId: result.fileId });
    }

    entry.photos = [...current, ...uploaded];
    declaration.markModified("idProofs");
    await declaration.save();
    return declaration.toObject();
  },

  async removeIdProofPhoto(
    userId: string,
    declarationId: string,
    idProofId: string,
    fileId: string
  ) {
    if (!Types.ObjectId.isValid(declarationId)) return null;

    const declaration = await PurchaseOldGoldModel.findOne({
      _id: toOid(declarationId),
      userId: toOid(userId),
      deletedAt: null,
    });
    if (!declaration) return null;

    const entry = (declaration.idProofs || []).find((e) => e.id === idProofId);
    if (!entry) {
      throw new AppError("ID proof not found", {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }

    const before = (entry.photos || []).length;
    entry.photos = (entry.photos || []).filter((p) => p.fileId !== fileId);
    if (entry.photos.length === before) {
      throw new AppError("Photo not found", {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }

    declaration.markModified("idProofs");
    await declaration.save();
    await deletePhotoIfUnreferenced(userId, fileId);
    return declaration.toObject();
  },

  async addWitnessPhotos(
    userId: string,
    declarationId: string,
    witnessId: string,
    files: any[]
  ) {
    if (!Types.ObjectId.isValid(declarationId)) return null;

    const declaration = await PurchaseOldGoldModel.findOne({
      _id: toOid(declarationId),
      userId: toOid(userId),
      deletedAt: null,
    });
    if (!declaration) return null;

    const witness = (declaration.witnesses || []).find(
      (w) => w.id === witnessId
    );
    // A witness recorded before ids existed has none, so it cannot be
    // addressed until the declaration is saved again and gets backfilled.
    if (!witness) {
      throw new AppError("Witness not found", {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }

    const current = witness.photos || [];
    const remaining = MAX_WITNESS_PHOTOS - current.length;
    if (remaining <= 0) {
      throw new AppError(
        `A witness can hold at most ${MAX_WITNESS_PHOTOS} photos`,
        { statusCode: 400, code: "BAD_REQUEST" }
      );
    }

    const storageKey = await resolveStorageKey(userId);

    const uploaded: DeclarationPhoto[] = [];
    for (const file of files.slice(0, remaining)) {
      // One level below the ornament photos, so a glance at the folder says
      // which are of the goods and which are somebody's ID.
      const result = await uploadOrnamentPhoto(
        file,
        storageKey,
        "purchase-old-gold",
        `${declaration.declarationNumber}/witnesses`
      );
      uploaded.push({ url: result.url, fileId: result.fileId });
    }

    witness.photos = [...current, ...uploaded];
    declaration.markModified("witnesses");
    await declaration.save();
    return declaration.toObject();
  },

  async removeWitnessPhoto(
    userId: string,
    declarationId: string,
    witnessId: string,
    fileId: string
  ) {
    if (!Types.ObjectId.isValid(declarationId)) return null;

    const declaration = await PurchaseOldGoldModel.findOne({
      _id: toOid(declarationId),
      userId: toOid(userId),
      deletedAt: null,
    });
    if (!declaration) return null;

    const witness = (declaration.witnesses || []).find(
      (w) => w.id === witnessId
    );
    if (!witness) {
      throw new AppError("Witness not found", {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }

    const before = (witness.photos || []).length;
    witness.photos = (witness.photos || []).filter((p) => p.fileId !== fileId);
    if (witness.photos.length === before) {
      throw new AppError("Photo not found", {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }

    declaration.markModified("witnesses");
    await declaration.save();
    await deletePhotoIfUnreferenced(userId, fileId);
    return declaration.toObject();
  },
};
