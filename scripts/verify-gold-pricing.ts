/**
 * Checks the wholesale pricing chain against the figures it was specified
 * with. Run: npm run verify:pricing
 *
 * Every number below is the wholesaler's own worked example, kept executable
 * so a change to purity uplift, wastage handling or the 99.50 conversion has
 * to restate the arithmetic out loud rather than quietly move what a retailer
 * owes.
 */
import {
  priceLine,
  chargedPurity,
  totalFine995,
  cashValueOfFine995,
} from "../src/common/utils/goldPricing";

let fail = 0;
const eq = (label: string, got: any, want: any) => {
  const ok = String(got) === String(want);
  if (!ok) fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: got ${got}, want ${want}`);
};

console.log("purity uplift, floor + 1, for 9K..23K");
([[37.5, 38], [41.7, 42], [58.5, 59], [75, 76], [83.3, 84], [91.6, 92], [95.8, 96]] as [number, number][])
  .forEach(([a, e]) => eq(`${a} ->`, chargedPurity(a), e));

console.log("");
console.log("24K settlement metal is NOT uplifted");
eq("99.5 charged as", chargedPurity(99.5), 99.5);
eq("10 g of 99.50, no wastage", priceLine({ weight: 10, purity: 99.5, wastage: 0 }).fine995.toFixed(3), "10.000");

console.log("");
console.log("the worked example: 10.365 g, 91.6%, 4% wastage");
const r = priceLine({ weight: 10.365, purity: 91.6, wastage: 4 });
eq("charged purity", r.chargedPurity, 92);
eq("effective %", r.effectivePercent, 96);
eq("fine 99.9", r.fine999.toFixed(3), "9.950");
eq("fine 99.50", r.fine995.toFixed(3), "10.000");

console.log("");
console.log("cash settlement at 15,450 per g of 99.50");
eq("value", cashValueOfFine995(r.fine995, 15450), 154500);

console.log("");
console.log("multi-item total");
eq("two identical lines", totalFine995([
  { weight: 10.365, purity: 91.6, wastage: 4 },
  { weight: 10.365, purity: 91.6, wastage: 4 },
]).toFixed(3), "20.000");

console.log("");
console.log(fail === 0 ? "ALL PASSED" : fail + " FAILED");
process.exit(fail === 0 ? 0 : 1);
