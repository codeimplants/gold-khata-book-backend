import { Types } from "mongoose";

/**
 * A batch of old ornaments moving through the shop, weighed at each stage.
 *
 * This is a RECORD rather than a form because the readings are taken hours
 * apart. Ornaments come over the counter in the morning, go into the pot, and
 * the lagdi is tested that afternoon — and nobody can leave a screen open in
 * between while the same device raises six other bills. Each stage is written
 * when it happens and the lot is picked up again later.
 *
 * One retailer per lot, from the moment it is received. Every gram in the lot
 * is theirs, so the credit needs no apportioning and there is nothing for two
 * retailers to dispute between them. A pot filled from several retailers is
 * recorded as several lots.
 */
export type MeltLotStatus =
    /** Weighed into the pot; nothing melted yet. */
    | "received"
    /** Melted, lagdi weighed. Waiting on the test. */
    | "melted"
    /** Tested and credited. The lot is closed. */
    | "tested";

export interface MeltLot {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    customerId: Types.ObjectId;
    dukandarId?: Types.ObjectId;

    /** Per-shop display number, "M-7". What the shopkeeper calls the lot. */
    lotNumber: string;
    status: MeltLotStatus;

    /** Stage 1 — what actually went into the pot, stones and lac already off. */
    potWeight: number;
    receivedAt: Date;

    /** Stage 2 — the lagdi, once dirt and impurities have burnt off. */
    afterMelt?: number;
    meltedAt?: Date;

    /** Stage 3 — the lagdi again after the skin test and rubbing, plus what
     *  the test said. */
    afterTesting?: number;
    purity?: number;
    testedAt?: Date;

    /** Derived at stage 3 and frozen there: the pure content at 99.9, and the
     *  99.50 credit that went onto the retailer's account. Stored rather than
     *  recomputed so a later change to the pricing rules cannot silently
     *  restate a lot that has already been settled. */
    fine999?: number;
    creditedWeight?: number;

    notes?: string;

    createdAt: Date;
    updatedAt: Date;
}

export interface CreateMeltLotDTO {
    potWeight: number;
    receivedAt?: Date;
    notes?: string;
}

export interface RecordMeltDTO {
    afterMelt: number;
    meltedAt?: Date;
    notes?: string;
}

export interface RecordTestDTO {
    afterTesting: number;
    purity: number;
    testedAt?: Date;
    notes?: string;
}
