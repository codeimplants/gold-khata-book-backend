/**
 * Guards the one invariant this module keeps breaking: the outstanding balance
 * on an advance order must be the SAME number wherever it is shown.
 *
 * It has now failed twice in production. First as a Rs.5 gap, when weightPaid
 * was rounded to 3dp and money was derived by multiplying that rounded gram
 * count by a rate. Then as a Rs.4,500 gap, when a shopkeeper corrected a
 * mistyped rate: the printed bill followed the new item rate while the order
 * screen stayed on the stale bookingRate.
 *
 * Runs the real pre-save hook with no database (it is the only anonymous
 * pre("save") on the schema, so it can be called directly) and mirrors the
 * rate-repointing guard from OrderService.updateOrder.
 *
 * Usage (from gold-khata-book-backend/):
 *   npx ts-node scripts/verify-advance-balance-consistency.ts
 *
 * Exits non-zero if any surface disagrees, so it can be wired into CI.
 */
import mongoose from "mongoose";
import {
    OrderModel,
    weightedItemRate,
    RATE_EPSILON,
} from "../src/modules/order/order.model";

/**
 * The order.model.ts pre("save") hook is the only anonymous one on the schema —
 * every other entry is a named mongoose plugin. Calling it directly runs the
 * real production maths with no connection and no validation in the way.
 */
const ourHooks = (OrderModel.schema as any).s.hooks._pres
    .get("save")
    .filter((h: any) => !h.fn.name)
    .map((h: any) => h.fn);

function runHook(doc: any): void {
    if (ourHooks.length !== 1) {
        throw new Error(
            `expected exactly 1 anonymous pre-save hook, found ${ourHooks.length} — harness needs updating`,
        );
    }
    ourHooks[0].call(doc);
}

/** Mirrors the guard added to OrderService.updateOrder. */
function applyItemEdit(order: any, newItems: any[]) {
    const previousRate = weightedItemRate(order.items, order.bookingRate);
    order.items = newItems;
    const nextRate = weightedItemRate(order.items, order.bookingRate);
    const rateChanged =
        nextRate > 0 && Math.abs(nextRate - previousRate) > RATE_EPSILON;

    if (rateChanged) {
        order.bookingRate = nextRate;
        const initial = [...(order.payments || [])].sort(
            (a: any, b: any) =>
                new Date(a.date).getTime() - new Date(b.date).getTime(),
        )[0] as any;
        if (
            initial &&
            Math.abs(Number(initial.goldRate) - previousRate) <= RATE_EPSILON
        ) {
            initial.goldRate = nextRate;
            initial.weightCovered = nextRate > 0 ? initial.amount / nextRate : 0;
        }
    }
    return { previousRate, nextRate, rateChanged };
}

const item = (rate: number) => ({
    itemName: "Bangles",
    itemType: "Gold",
    weight: 90,
    grossWeight: 90,
    rate,
    makingChargeType: "Per Gram",
    makingChargeValue: 200,
    purity: "24K - 99.5%",
    quantity: 1,
});

const rs = (n: number) => Math.round(n).toLocaleString("en-IN");

async function scenario(
    name: string,
    payments: any[],
    startRate: number,
    editedRate: number,
    expectRepoint: boolean,
    includeGST = false,
    /**
     * Whether the create screen's quote is still reproducible for this order.
     *
     * That screen computes `subtotal + GST - advance`, which is the money route:
     * it assumes one rate for the whole order. That holds at creation and for
     * any later correction of it, but NOT once an order carries payments taken
     * at genuinely different rates — there the locked grams are worth more than
     * the cash that bought them, and the money route cannot express that. It is
     * a limitation of that quote, not a disagreement to fix.
     */
    createScreenComparable = true,
) {
    const order: any = new OrderModel({
        userId: new mongoose.Types.ObjectId(),
        customerId: new mongoose.Types.ObjectId(),
        orderNumber: "ADV-TEST",
        paymentMode: "advance",
        status: "pending",
        items: [item(startRate)],
        payments,
        bookingRate: startRate,
        isOrnamentExchanges: false,
        remainingWeight: 0,
        includeGST,
        gstRate: 3,
    });

    runHook(order);
    const edit = applyItemEdit(order, [item(editedRate)]);
    runHook(order);

    // What the mobile order screen derives on its own today.
    const screen =
        order.remainingWeight * order.bookingRate + order.estimatedMakingCharges;
    // What the printed bill derives on its own today (to be replaced by `stored`).
    const printLegacy = order.amount - order.totalPaid;
    // The single value the backend now persists for everyone to display.
    const stored = order.estimatedBalance;

    // What the CREATE screen quotes before the order exists:
    // subtotalBeforeGst + gstAmount - advance. The figure a customer is shown
    // while deciding to pay must survive into the order they end up with.
    const cashPaid = order.payments.reduce(
        (s: number, p: any) => s + Number(p.amount || 0),
        0,
    );
    const createScreen = Math.max(0, order.subTotal + order.gstAmount - cashPaid);

    // The screen breakdown carries no GST row today, so compare it ex-GST.
    const agree =
        Math.abs(screen + order.gstAmount - stored) < 0.5 &&
        (!createScreenComparable || Math.abs(createScreen - stored) < 0.5);

    const firstPayment = order.payments[0];
    const repointed =
        Math.abs(Number(firstPayment.goldRate) - edit.nextRate) <= RATE_EPSILON &&
        edit.rateChanged;
    const guardOk = repointed === expectRepoint;

    console.log(`\n=== ${name} ===`);
    console.log(
        `  rate ${edit.previousRate} -> ${edit.nextRate}   changed=${edit.rateChanged}   bookingRate now ${order.bookingRate}`,
    );
    order.payments.forEach((p: any, i: number) =>
        console.log(
            `  payment ${i + 1}: Rs.${rs(p.amount)} @ ${p.goldRate}/gm  ->  ${p.weightCovered.toFixed(4)} gm`,
        ),
    );
    console.log(
        `  weightPaid ${order.weightPaid.toFixed(4)}   remaining ${order.remainingWeight.toFixed(4)}`,
    );
    console.log(
        `  screen(ex-GST) Rs.${rs(screen)} + GST Rs.${rs(order.gstAmount)} = Rs.${rs(screen + order.gstAmount)}`,
    );
    console.log(
        `  createScreen Rs.${rs(createScreen)}${createScreenComparable ? "" : " (not comparable: multi-rate order)"}   stored Rs.${rs(stored)}   (legacy print formula Rs.${rs(printLegacy)})`,
    );
    console.log(`  all routes vs stored: ${agree ? "AGREE" : "*** MISMATCH ***"}`);
    console.log(
        `  history guard: initial payment ${repointed ? "repointed" : "left untouched"} (expected ${expectRepoint ? "repointed" : "untouched"}) ${guardOk ? "OK" : "*** WRONG ***"}`,
    );

    return agree && guardOk;
}

async function main() {
    const results: boolean[] = [];

    results.push(
        await scenario(
            "Reported bug: rate corrected 14400 -> 14450",
            [
                {
                    amount: 150000,
                    goldRate: 14400,
                    weightCovered: 150000 / 14400,
                    date: new Date("2026-08-05"),
                },
            ],
            14400,
            14450,
            true,
        ),
    );

    results.push(
        await scenario(
            "History guard: Jan @12000 + Aug @14400, edit to 14450",
            [
                {
                    amount: 100000,
                    goldRate: 12000,
                    weightCovered: 100000 / 12000,
                    date: new Date("2026-01-10"),
                },
                {
                    amount: 50000,
                    goldRate: 14400,
                    weightCovered: 50000 / 14400,
                    date: new Date("2026-08-05"),
                },
            ],
            14400,
            14450,
            false,
            false,
            false,
        ),
    );

    results.push(
        await scenario(
            "No-op: rate unchanged, only weights/names edited",
            [
                {
                    amount: 150000,
                    goldRate: 14400,
                    weightCovered: 150000 / 14400,
                    date: new Date("2026-08-05"),
                },
            ],
            14400,
            14400,
            false,
        ),
    );

    results.push(
        await scenario(
            "GST opted in: 3% quoted on the total item cost",
            [
                {
                    amount: 150000,
                    goldRate: 14400,
                    weightCovered: 150000 / 14400,
                    date: new Date("2026-08-05"),
                },
            ],
            14400,
            14450,
            true,
            true,
        ),
    );

    const ok = results.every(Boolean);
    console.log(`\n${ok ? "ALL SCENARIOS PASS" : "FAILURES ABOVE"}`);
    process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
