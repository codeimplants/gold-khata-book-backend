/**
 * One-off migration: give every existing customer a per-shop display code
 * ("C-1", "C-2", …), and move each shop's `customer_<dukandarId>` counter past
 * the highest code it just handed out.
 *
 * Why this needs a script at all
 * -----------------------------
 * `customer.model.ts` assigns `customerCode` in a `pre("save")` hook, which
 * only ever runs for a customer being written. Every customer created before
 * the field existed therefore has none, and nothing would ever give them one —
 * the shopkeeper would see codes on new customers and blanks on the hundreds
 * they already have, which is worse than no codes at all.
 *
 * Ordering
 * --------
 * Codes are handed out per shop in `createdAt` order, so the customer a shop
 * added first is C-1. That is the only ordering a shopkeeper would predict, and
 * it keeps the numbers stable if the migration is ever re-run.
 *
 * The counter
 * -----------
 * The hook draws from `Counter { id: "customer_<dukandarId>" }`. Backfilling
 * without advancing that counter would make the next customer a shop adds reuse
 * C-1, so two customers would carry the same code — exactly the collision this
 * feature exists to prevent. The counter is therefore set to the shop's highest
 * assigned sequence, and only ever raised, never lowered.
 *
 * Safe to re-run: customers that already have a code are skipped, and a shop
 * whose counter is already high enough is left alone.
 *
 * Usage (from gold-khata-book-backend/):
 *   NODE_ENV=dev npm run migrate:customer-code              # dry-run: reports what would change
 *   NODE_ENV=dev npm run migrate:customer-code -- --apply   # writes the codes
 *
 * ORDER MATTERS. Per environment:
 *
 *   1. Deploy the backend code that declares `customerCode`.
 *   2. THEN run this with --apply.
 *   3. Then the app build that displays the code.
 *
 * Between steps 1 and 2 nothing is broken — customers created in that window
 * get their code from the hook, and the backfill skips them.
 *
 * Run the whole sequence on dev, then preprod, then prod.
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

const APPLY = process.argv.includes("--apply");

/** Must match the hook in customer.model.ts, character for character. */
const counterId = (dukandarId: unknown) => `customer_${String(dukandarId)}`;
const codeFor = (sequence: number) => `C-${sequence}`;

/**
 * The sequence number already inside a stored code, or 0.
 *
 * Read rather than assumed: a shop part-way through the rollout has real codes
 * from the hook, and the backfill has to continue past the highest of them
 * instead of starting again at 1 and duplicating them.
 */
const sequenceOf = (code: unknown): number => {
    const match = /^C-(\d+)$/.exec(String(code ?? ""));
    return match ? Number(match[1]) : 0;
};

const MISSING_CODE = {
    $or: [
        { customerCode: { $exists: false } },
        { customerCode: null },
        { customerCode: "" },
    ],
};

const run = async () => {
    await mongoose.connect(getMongoURI(), { serverSelectionTimeoutMS: 10000 });
    console.log(`✅ MongoDB connected [${NODE_ENV}]`);

    const customers = mongoose.connection.collection("customers");
    const counters = mongoose.connection.collection("counters");

    const total = await customers.countDocuments({});
    const missing = await customers.countDocuments(MISSING_CODE as any);

    console.log(`\n${total} customer(s) total, ${missing} without a code.`);

    if (missing === 0) {
        console.log("\n✓ Every customer already has a code. Checking counters only.");
    }

    // Grouped in memory rather than with an aggregation: this collection is
    // small (one shop's customer list, times the number of shops), and the
    // per-shop ordering has to be applied to the SAME list the writes use.
    const all = await customers
        .find({}, { projection: { _id: 1, dukandarId: 1, customerCode: 1, createdAt: 1 } })
        .sort({ createdAt: 1 })
        .toArray();

    const byShop = new Map<string, any[]>();
    for (const customer of all) {
        const key = String(customer.dukandarId);
        if (!byShop.has(key)) byShop.set(key, []);
        byShop.get(key)!.push(customer);
    }

    let assigned = 0;
    let countersRaised = 0;

    for (const [shopId, list] of byShop) {
        // Where this shop's numbering already reaches — the highest code in use
        // and the counter, whichever is further along. Starting below either
        // would mint a duplicate.
        const highestInUse = list.reduce(
            (max: number, c: any) => Math.max(max, sequenceOf(c.customerCode)),
            0,
        );
        const counter = await counters.findOne({ id: counterId(shopId) });
        const counterSeq = Number(counter?.seq ?? 0);

        const startedAt = Math.max(highestInUse, counterSeq);
        let next = startedAt;

        const needsCode = list.filter((c: any) => sequenceOf(c.customerCode) === 0);
        for (const customer of needsCode) {
            next += 1;
            if (APPLY) {
                await customers.updateOne(
                    { _id: customer._id },
                    { $set: { customerCode: codeFor(next) } },
                );
            }
            assigned += 1;
        }

        if (next > counterSeq) {
            if (APPLY) {
                // upsert, because a shop that has never had a counter row still
                // needs one — otherwise the hook starts it at 1 and collides
                // with everything this loop just wrote.
                await counters.updateOne(
                    { id: counterId(shopId) },
                    { $set: { seq: next } },
                    { upsert: true },
                );
            }
            countersRaised += 1;
        }

        if (needsCode.length > 0) {
            console.log(
                `  shop ${shopId}: ${needsCode.length} coded ` +
                `(${codeFor(startedAt + 1)}…${codeFor(next)}), ` +
                `counter ${counterSeq} → ${next}`,
            );
        }
    }

    console.log(
        `\n${APPLY ? "Wrote" : "Would write"} ${assigned} code(s) across ` +
        `${byShop.size} shop(s); ${countersRaised} counter(s) ` +
        `${APPLY ? "raised" : "would be raised"}.`,
    );

    if (!APPLY) {
        console.log("\nDry run. Re-run with -- --apply to make the change.");
        await mongoose.disconnect();
        return;
    }

    const stillMissing = await customers.countDocuments(MISSING_CODE as any);
    if (stillMissing > 0) {
        throw new Error(
            `${stillMissing} customer(s) still have no code — investigate before continuing.`,
        );
    }

    // A duplicate code within one shop is the one outcome that would make the
    // whole feature lie, so it is checked rather than assumed.
    const duplicates = await customers
        .aggregate([
            {
                $group: {
                    _id: { dukandarId: "$dukandarId", customerCode: "$customerCode" },
                    n: { $sum: 1 },
                },
            },
            { $match: { n: { $gt: 1 } } },
        ])
        .toArray();
    if (duplicates.length > 0) {
        console.error("\nDuplicate codes:", JSON.stringify(duplicates));
        throw new Error("Duplicate customer codes within a shop — investigate before continuing.");
    }

    console.log("\n✅ Done. Every customer has a unique code within their shop.");
    await mongoose.disconnect();
};

run().catch(async (err) => {
    console.error("\n❌ Migration failed:", err);
    console.error(
        "\nRe-runnable: customers that were already coded are skipped and counters are\n" +
        "only ever raised, so finishing a partial run is just another `-- --apply`.",
    );
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});
