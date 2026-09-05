import { getNextSequence } from "./counter.util";

/**
 * The one number series a shop's documents are drawn from.
 *
 * Every order and every invoice takes its number from here, so a shop's
 * paperwork reads as one sequence — INV-1, INV-2, INV-3 — regardless of which
 * collection a given document happens to live in. There is no separate ADV-n
 * series: a retailer looking at two bills should not have to know that one was
 * stored as an Order and the other as an Invoice.
 *
 * Scoped per shop, not global. A global counter means two wholesalers
 * interleave numbers, so each sees gaps in their own book that they cannot
 * explain and that look like deleted bills.
 */
export const nextDocumentNumber = async (
    userId: unknown,
    dukandarId?: unknown,
): Promise<string> => {
    const scope = userId || dukandarId || "global";
    const sequence = await getNextSequence(`invoice_${scope}`);
    return `INV-${sequence}`;
};
