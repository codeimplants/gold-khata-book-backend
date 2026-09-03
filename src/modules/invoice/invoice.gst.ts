import type { Invoice } from "./invoice.types";

// 15-char GSTIN: 2-digit state code + 10-char PAN + entity + Z + checksum.
// Kept loose (13 alphanumerics after state code) to match client-side validation.
export const GSTIN_REGEX = /^[0-9]{2}[A-Z0-9]{13}$/;

export const DEFAULT_HSN_CODE = "7113"; // Gold/silver jewellery

export type SupplyType = "intra" | "inter";

export interface GstSplit {
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  supplyType: SupplyType;
  placeOfSupply?: string;
}

const round3 = (n: number) => Number(Number(n || 0).toFixed(3));

export function gstinStateCode(gstin?: string | null): string | undefined {
  if (!gstin) return undefined;
  const normalized = gstin.trim().toUpperCase();
  if (!GSTIN_REGEX.test(normalized)) return undefined;
  return normalized.slice(0, 2);
}

/**
 * Supply type from GSTIN state codes alone (first 2 digits = state).
 * Direction-agnostic: works for sales (shop vs customer) and purchases
 * (shop vs supplier). Missing/invalid counterparty GSTIN => over-the-counter
 * B2C (or unregistered supplier) => intra-state.
 */
export function computeSupplyType(
  shopGstin?: string | null,
  otherGstin?: string | null
): SupplyType {
  const shopState = gstinStateCode(shopGstin);
  const otherState = gstinStateCode(otherGstin);
  if (!shopState || !otherState) return "intra";
  return shopState === otherState ? "intra" : "inter";
}

/**
 * Split a total GST amount into CGST/SGST vs IGST based on supply type.
 * Intra-state: CGST = SGST = half. Inter-state: all IGST.
 */
export function splitGstAmount(
  gstAmount: number,
  shopGstin?: string | null,
  otherGstin?: string | null
): GstSplit {
  const supplyType = computeSupplyType(shopGstin, otherGstin);
  const total = round3(gstAmount);
  const placeOfSupply =
    gstinStateCode(otherGstin) ?? gstinStateCode(shopGstin);

  if (supplyType === "inter") {
    return {
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: total,
      supplyType,
      placeOfSupply,
    };
  }

  const half = round3(total / 2);
  return {
    cgstAmount: half,
    // Assign remainder to SGST so cgst + sgst always equals the total
    sgstAmount: round3(total - half),
    igstAmount: 0,
    supplyType,
    placeOfSupply,
  };
}

export interface DerivedGstFields {
  gstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  supplyType: SupplyType;
  placeOfSupply?: string;
  shopGstin?: string;
  customerGstin?: string;
  hsnCodes: string;
  /** true when the split was derived from a legacy single gstAmount */
  legacyDerived: boolean;
}

/**
 * Report-time derivation for invoices. New invoices carry stored split
 * fields; legacy invoices (created before the GST extension) get a 50/50
 * CGST/SGST split, HSN 7113 and a back-computed rate — flagged
 * `legacyDerived` so reports can footnote them.
 */
export function deriveGstFields(
  invoice: Pick<
    Invoice,
    | "includeGST"
    | "gstAmount"
    | "subTotal"
    | "items"
  > &
    Partial<
      Pick<
        Invoice,
        | "gstRate"
        | "cgstAmount"
        | "sgstAmount"
        | "igstAmount"
        | "supplyType"
        | "placeOfSupply"
        | "shopGstin"
        | "customerGstin"
      >
    >,
  currentShopGstin?: string,
  currentShopGstRate?: number
): DerivedGstFields {
  const gstAmount = round3(invoice.gstAmount);
  const hasStoredSplit =
    invoice.cgstAmount != null ||
    invoice.sgstAmount != null ||
    invoice.igstAmount != null;

  const hsnCodes =
    Array.from(
      new Set(
        (invoice.items || [])
          .map((item: any) => item?.hsnCode)
          .filter((code: any) => typeof code === "string" && code.length > 0)
      )
    ).join(", ") || DEFAULT_HSN_CODE;

  const shopGstin = invoice.shopGstin || currentShopGstin || undefined;
  const customerGstin = invoice.customerGstin || undefined;

  if (hasStoredSplit) {
    return {
      gstRate:
        invoice.gstRate ??
        (invoice.subTotal > 0
          ? Number(((gstAmount / invoice.subTotal) * 100).toFixed(2))
          : currentShopGstRate ?? 3),
      cgstAmount: round3(invoice.cgstAmount ?? 0),
      sgstAmount: round3(invoice.sgstAmount ?? 0),
      igstAmount: round3(invoice.igstAmount ?? 0),
      supplyType: invoice.supplyType ?? "intra",
      placeOfSupply: invoice.placeOfSupply ?? gstinStateCode(shopGstin),
      shopGstin,
      customerGstin,
      hsnCodes,
      legacyDerived: false,
    };
  }

  const split = splitGstAmount(gstAmount, shopGstin, customerGstin);
  const gstRate =
    invoice.gstRate ??
    (invoice.subTotal > 0
      ? Number(((gstAmount / invoice.subTotal) * 100).toFixed(2))
      : currentShopGstRate ?? 3);

  return {
    gstRate,
    ...split,
    shopGstin,
    customerGstin,
    hsnCodes,
    legacyDerived: true,
  };
}
