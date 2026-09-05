/**
 * How a wholesale line is priced, and the only place that decides it.
 *
 * A retailer's debt is denominated in FINE GOLD AT 99.50, not in the ornament's
 * own grams and not in rupees. 99.50 rather than 99.9 because 99.9 is not
 * something the market actually trades without a special order, so every
 * settlement — metal, cash, or a mix — is struck at 99.50.
 *
 * The chain for one item, using the worked example 10.365 g at 91.6% with 4%
 * wastage:
 *
 *   1. purity is rounded UP by the wholesaler   91.6  -> 92
 *   2. wastage (Tunch) is ADDED to that purity  92 + 4 -> 96
 *   3. fine gold at 99.9   10.365 * 96 / 100        = 9.950 g
 *   4. fine gold at 99.50  9.950 / 99.50 * 100      = 10.000 g
 *
 * Step 2 is addition, not a multiplier on the fine weight. The two differ by
 * real money — on 100 g at 92 with 8% wastage it is 100.000 g against 99.360 g,
 * about Rs.6,000 at current rates — so the distinction is deliberate.
 */

/** The fineness every settlement is struck at. */
export const SETTLEMENT_FINENESS = 99.5;

/** Weights are recorded and reconciled to 3 decimals throughout. */
const round3 = (n: number): number => Number((Number(n) || 0).toFixed(3));

/**
 * The purity the wholesaler actually charges on: `floor(actual) + 1`.
 *
 * Not `Math.ceil`. 22K is 91.6 and becomes 92, which ceiling would also give —
 * but 18K is exactly 75 and still becomes 76, which ceiling would leave at 75.
 * The uplift is the wholesaler's margin on the metal, so it is a floor-plus-one,
 * not a rounding.
 *
 *   9K  37.5 -> 38    18K 75.0 -> 76
 *   10K 41.7 -> 42    20K 83.3 -> 84
 *   14K 58.5 -> 59    22K 91.6 -> 92
 *                     23K 95.8 -> 96
 *
 * It stops at 23K. The uplift is defined for 9K through 23K, and settlement
 * metal is already 99.50 — upliftING that to 100 would invent fineness that
 * does not exist and quietly overcharge on every payment made in pure gold.
 */
export const chargedPurity = (actualPurity: number): number => {
  const actual = Number(actualPurity) || 0;
  if (actual >= SETTLEMENT_FINENESS) return actual;
  return Math.floor(actual) + 1;
};

export interface LinePricingInput {
  /** The ornament's weight as weighed, in grams. */
  weight: number;
  /** Purity as entered, in percent — 91.6 for 22K. Rounded up internally. */
  purity: number;
  /** Wastage / Tunch, in percent. Added to the charged purity. */
  wastage?: number;
}

export interface LinePricing {
  /** Purity actually charged on — see chargedPurity. */
  chargedPurity: number;
  /** chargedPurity + wastage, the percentage the weight is taken at. */
  effectivePercent: number;
  /** Fine gold at 99.9, in grams. */
  fine999: number;
  /** Fine gold at 99.50 — what the retailer owes. */
  fine995: number;
}

/**
 * One item's fine-gold content, at both finenesses.
 *
 * `fine999` is rounded to 3dp BEFORE the 99.50 conversion rather than carrying
 * full precision through. That is the figure written on the bill, and a khata
 * is reconciled by hand against what is written — so the app has to reach the
 * same 99.50 number the retailer gets working forward from the printed 99.9
 * weight, not one a hair away from it.
 */
export const priceLine = (input: LinePricingInput): LinePricing => {
  const purity = chargedPurity(input.purity);
  const effectivePercent = purity + (Number(input.wastage) || 0);

  const fine999 = round3(((Number(input.weight) || 0) * effectivePercent) / 100);
  const fine995 = round3((fine999 / SETTLEMENT_FINENESS) * 100);

  return { chargedPurity: purity, effectivePercent, fine999, fine995 };
};

/** Every line's 99.50 fine weight, summed — the order's metal position. */
export const totalFine995 = (items: LinePricingInput[]): number =>
  round3((items || []).reduce((sum, item) => sum + priceLine(item).fine995, 0));

/* ---------------------------------------------------------------------------
 * METAL COMING IN
 *
 * The reverse direction, and deliberately NOT the reverse arithmetic. Selling
 * uplifts the purity, adds wastage and converts at the exact fineness ratio;
 * buying takes the purity as found, applies no wastage, and converts at a flat
 * trade rule. That asymmetry is where the wholesaler's margin lives.
 *
 * The instinct when reading this file is to notice the duplication and share
 * one conversion helper between the two directions. Doing that hands the
 * margin straight back on every lot — see the table in AGENTS.md.
 * ------------------------------------------------------------------------- */

/**
 * Grams of settlement metal added when converting 99.9 to 99.50 on the way IN:
 * 10 mg for every 5 g, so +0.200%.
 *
 * Not the true ratio, which is +0.503%. On a 9.050 g lot the flat rule credits
 * 9.068 g where the ratio would give 9.096 g — a 0.027 g spread the trade
 * settles by convention rather than by arithmetic.
 */
export const INBOUND_UPLIFT_PER_GRAM = 0.010 / 5;

/** 99.9 fine to the 99.50 the retailer is credited in. */
export const inboundFine995 = (fine999: number): number => {
  const fine = Number(fine999) || 0;
  return round3(fine + fine * INBOUND_UPLIFT_PER_GRAM);
};

/**
 * Metal handed over as a payment or a melt lot, in 99.50 terms.
 *
 * `purity` is used exactly as found — no uplift. Metal already at settlement
 * fineness passes through untouched rather than being credited a bonus it has
 * not earned.
 */
export const priceInboundMetal = (weight: number, purity: number): number => {
  const w = Number(weight) || 0;
  const p = Number(purity) || 0;
  if (w <= 0 || p <= 0) return 0;

  if (p >= SETTLEMENT_FINENESS) return round3(w * (p / SETTLEMENT_FINENESS));

  return inboundFine995(round3((w * p) / 100));
};

/**
 * What that metal costs in rupees today.
 *
 * `rate` is per gram of 99.50, the only rate this product quotes, so no
 * fineness conversion happens here — it would double-apply the one already
 * done in priceLine.
 */
export const cashValueOfFine995 = (fine995: number, rate: number): number =>
  Number(((Number(fine995) || 0) * (Number(rate) || 0)).toFixed(2));
