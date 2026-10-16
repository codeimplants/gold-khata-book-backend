/**
 * How a silver line is priced. Silver is its own account, beside gold.
 *
 * A silver wholesaler deals by NET weight at a rate per gram, and nothing else:
 * there is no purity uplift and no wastage. The retailer's silver debt is that
 * net weight in grams, and its rupee value is net weight x rate:
 *
 *   gross 105.250 g, packet 5.250 g  ->  net 100.000 g
 *   100.000 g at Rs.95/g             ->  Rs.9,500.00
 *
 * Kept apart from goldPricing.ts on purpose. Gold settles in fine 99.50 and
 * silver in its own grams. Summing a silver gram into a gold total would put
 * two metals in one number, and that number would be wrong for both.
 *
 * The app mirrors this file (src/utils/silverPricing.ts) for its live total,
 * so change both together.
 */

const round3 = (n: number): number => Number((Number(n) || 0).toFixed(3));

/** True when a line is silver. Lines saved before silver existed are gold. */
export const isSilverItem = (item: { metal?: string } | null | undefined): boolean =>
    item?.metal === "silver";

/**
 * Net weight from gross less packet, to 3dp, never below zero.
 *
 * The form fills Net weight in with this, and the user can type over it. A
 * wholesaler sometimes weighs net directly, so what is stored is the net weight
 * the user confirmed, not this figure worked out again.
 */
export const silverNetWeight = (grossWeight: number, packetWeight: number): number =>
    round3(Math.max(0, (Number(grossWeight) || 0) - (Number(packetWeight) || 0)));

/** Rupees for one line: net weight x rate per gram, to the paisa. */
export const silverLineValue = (netWeight: number, rate: number): number =>
    Number(((Number(netWeight) || 0) * (Number(rate) || 0)).toFixed(2));

/** Every silver line's net weight, summed: the order's silver position. */
export const totalSilverWeight = (items: { metal?: string; weight?: number }[]): number =>
    round3((items || []).filter(isSilverItem).reduce((s, i) => s + (Number(i.weight) || 0), 0));
