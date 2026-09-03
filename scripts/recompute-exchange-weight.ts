/**
 * One-off correction: make old gold count toward an advance order's WEIGHT.
 *
 * Background: an exchange reduced the rupee subtotal but never `weightPaid`, so
 * an order could be fully settled in money while still reporting that the
 * customer owed the full weight — the two halves of the same order disagreed.
 * `order.model.ts`'s pre-save hook now derives `exchangeWeightCovered` and folds
 * it into `weightPaid`, but `remainingWeight` is a STORED field, so existing
 * orders keep their old (too high) value until something saves them.
 *
 * This script loads each affected order and saves it, letting the hook
 * recompute. It changes no input data — only derived fields. The dry run
 * still performs a real save (inside a transaction that is then aborted) so
 * the report reflects the actual hook output, not an approximation of it.
 *
 * The corrections move in the customer's favour (they owe less weight than the
 * app currently claims), so run the dry run first and read the report: if a
 * shopkeeper has quoted a remaining weight to someone, they need to know it
 * changed.
 *
 * Usage (from gold-khata-book-backend/):
 *   NODE_ENV=dev npx ts-node scripts/recompute-exchange-weight.ts
 *   NODE_ENV=dev npx ts-node scripts/recompute-exchange-weight.ts --apply
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config({ path: `.env.${process.env.NODE_ENV}` }); // env-specific file on server
dotenv.config(); // fallback to .env for local development

const { NODE_ENV, DEV_DB_URL, PREPROD_DB_URL, PROD_DB_URL } = process.env;

const getMongoURI = (): string => {
    switch (NODE_ENV) {
        case "dev": return DEV_DB_URL as string;
        case "preprod": return PREPROD_DB_URL as string;
        case "prod": return PROD_DB_URL as string;
        default: throw new Error("NODE_ENV must be dev | preprod | prod");
    }
};

async function run() {
    const apply = process.argv.includes("--apply");

    const uri = getMongoURI();
    if (!uri) throw new Error("MongoDB URI is missing in environment variables");

    await mongoose.connect(uri);
    console.log(`✅ Connected [${NODE_ENV}]${apply ? " — APPLY mode" : " — DRY RUN"}`);

    // Imported after connecting so the model registers against this connection.
    // Uses the real model deliberately: the whole point is to run its pre-save
    // hook, which is where the corrected maths lives.
    const { OrderModel } = await import("../src/modules/order/order.model");

    const orders = await OrderModel.find({
        isOrnamentExchanges: true,
        deletedAt: null,
    });

    console.log(`Found ${orders.length} order(s) with an exchange.\n`);

    let changed = 0;

    for (const order of orders as any[]) {
        const before = {
            weightPaid: order.weightPaid,
            remainingWeight: order.remainingWeight,
            exchangeWeightCovered: order.exchangeWeightCovered ?? 0,
        };

        // .validate() was tried first and is wrong: it runs schema validators
        // only, never the pre("save") hook that actually computes
        // exchangeWeightCovered / weightPaid / remainingWeight. A dry run built
        // on it silently compared each order's stored values against themselves
        // and reported "0 would change" even for orders that were visibly wrong
        // (confirmed against dev: ADV-33 has a real exchange, weightPaid 0).
        //
        // Instead, run the actual save path — inside a transaction that is
        // always aborted for a dry run, so the exact same hook Mongoose runs in
        // production computes the numbers, with zero drift risk, and nothing
        // is written unless --apply.
        const session = await mongoose.startSession();
        try {
            session.startTransaction();
            await order.save({ session });
            if (apply) {
                await session.commitTransaction();
            } else {
                await session.abortTransaction();
            }
        } catch (err) {
            await session.abortTransaction();
            throw err;
        } finally {
            await session.endSession();
        }

        const after = {
            weightPaid: order.weightPaid,
            remainingWeight: order.remainingWeight,
            exchangeWeightCovered: order.exchangeWeightCovered ?? 0,
        };

        const moved =
            before.remainingWeight !== after.remainingWeight ||
            before.weightPaid !== after.weightPaid;

        if (moved) {
            changed++;
            console.log(
                `${order.orderNumber || order._id} [${order.status}]  ` +
                `remaining ${before.remainingWeight}g → ${after.remainingWeight}g   ` +
                `(old gold settled ${after.exchangeWeightCovered}g)` +
                (order.exchangeExcess > 0
                    ? `   ⚠ exchange exceeds order by ₹${order.exchangeExcess}`
                    : ""),
            );
        }
    }

    console.log(
        `\n${changed} order(s) ${apply ? "corrected" : "would change"}.` +
        (apply ? "" : "\nRe-run with --apply to write these changes."),
    );

    await mongoose.disconnect();
}

run().catch((err) => {
    console.error("❌ Failed:", err);
    process.exit(1);
});
