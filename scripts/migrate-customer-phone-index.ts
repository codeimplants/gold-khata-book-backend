/**
 * One-off migration: replace the customers collection's plain unique
 * `{ phone: 1, dukandarId: 1 }` index with a PARTIAL unique index, so a shop
 * can have more than one customer without a phone number.
 *
 * Why this needs a script at all
 * -----------------------------
 * Changing the options in `customer.model.ts` does NOT change the live index.
 * Mongoose's auto-indexing calls `createIndex` on boot, and Mongo answers an
 * existing index of the same name with different options with
 * `IndexOptionsConflict` (code 85) rather than replacing it. That error is
 * emitted on the model's `index` event, which nothing here listens to — so the
 * old index survives silently and the second phoneless customer for a shop
 * still fails with E11000.
 *
 * Old index: { phone: 1, dukandarId: 1 }, unique
 *            → a missing `phone` is indexed as null, so customer #2 without a
 *              number collides with customer #1.
 * New index: { phone: 1, dukandarId: 1 }, unique,
 *            partialFilterExpression: { phone: { $type: "string" } }
 *            → only customers who actually have a number are indexed; numbers
 *              stay unique per shop, absent ones do not compete.
 *
 * `sparse: true` is deliberately NOT the fix: on a compound index it skips a
 * document only when EVERY indexed field is missing, and `dukandarId` is always
 * present.
 *
 * The script also reports (and with --apply, unsets) any customer stored with
 * an empty-string phone. `""` is a string, so the new partial index would index
 * it as a value and two such customers would still collide — the app never
 * writes that shape, but a pre-existing row could.
 *
 * Safe to re-run: it verifies the current shape first and exits early when the
 * index is already correct.
 *
 * Usage (from gold-khata-book-backend/):
 *   NODE_ENV=dev npm run migrate:customer-phone-index              # dry-run: reports what would change
 *   NODE_ENV=dev npm run migrate:customer-phone-index -- --apply   # drops + recreates the index
 *
 * ORDER MATTERS, IN BOTH DIRECTIONS. Per environment:
 *
 *   1. Deploy the backend code that declares the partial index.
 *   2. THEN run this with --apply.
 *   3. Then the app build that can save a customer without a phone number.
 *
 * Not the other way around. Running this before the new code is deployed leaves
 * the OLD code declaring a plain-unique index over this partial one, and its
 * `createIndex` then fails with IndexOptionsConflict on every boot — which the
 * old code has no handler for, so it exits and PM2 restarts it in a loop.
 * (customer.model.ts now catches that, but only in the new code.)
 *
 * Between steps 1 and 2 nothing is broken: the server runs on the old index,
 * which is what it was already doing.
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

const INDEX_NAME = "phone_1_dukandarId_1";
const APPLY = process.argv.includes("--apply");

/** The exact shape `customer.model.ts` declares. Keep the two in step. */
const TARGET = {
    key: { phone: 1, dukandarId: 1 },
    options: {
        name: INDEX_NAME,
        unique: true,
        partialFilterExpression: { phone: { $type: "string" } },
    },
} as const;

/**
 * Set once the old index has actually been dropped. Only then is "re-run to
 * finish" the right advice — printing it after a failure to even connect sends
 * you looking for a half-applied migration that never started.
 */
let dropped = false;

const isAlreadyMigrated = (index: any): boolean =>
    index?.unique === true &&
    JSON.stringify(index?.partialFilterExpression) ===
        JSON.stringify(TARGET.options.partialFilterExpression);

const run = async () => {
    await mongoose.connect(getMongoURI(), { serverSelectionTimeoutMS: 10000 });
    console.log(`✅ MongoDB connected [${NODE_ENV}]`);

    const customers = mongoose.connection.collection("customers");
    const indexes = await customers.indexes();
    const existing = indexes.find((i: any) => i.name === INDEX_NAME);

    console.log(`\nCurrent \`${INDEX_NAME}\`:`, existing ? JSON.stringify(existing) : "(absent)");

    // Empty-string phones would defeat the new index — report them either way.
    const blanks = await customers.countDocuments({ phone: "" });
    if (blanks > 0) {
        console.log(`\n⚠ ${blanks} customer(s) stored with an empty-string phone.`);
        console.log("  `\"\"` is a string, so the partial index treats it as a real value and");
        console.log("  two such customers in one shop would still collide. They need unsetting.");
        if (APPLY) {
            const res = await customers.updateMany({ phone: "" }, { $unset: { phone: "" } });
            console.log(`  → unset on ${res.modifiedCount} customer(s).`);
        }
    }

    if (existing && isAlreadyMigrated(existing)) {
        console.log("\n✓ Index is already partial + unique. Nothing to do.");
        await mongoose.disconnect();
        return;
    }

    if (!APPLY) {
        console.log("\nDry run. Would:");
        if (existing) console.log(`  1. dropIndex("${INDEX_NAME}")`);
        console.log(`  ${existing ? 2 : 1}. createIndex(${JSON.stringify(TARGET.key)}, ${JSON.stringify(TARGET.options)})`);
        console.log("\nRe-run with -- --apply to make the change.");
        await mongoose.disconnect();
        return;
    }

    // Drop then create, rather than createIndex-with-new-options, which Mongo
    // rejects with IndexOptionsConflict while the old index exists.
    //
    // There is a window between the two calls where phone uniqueness is not
    // enforced. That is acceptable: it lasts milliseconds, and the application
    // layer also checks for a duplicate phone before inserting
    // (customer.controller.ts). Run it outside shop hours anyway.
    if (existing) {
        await customers.dropIndex(INDEX_NAME);
        dropped = true;
        console.log(`\n✓ Dropped "${INDEX_NAME}".`);
    }

    await customers.createIndex(TARGET.key as any, TARGET.options as any);
    console.log(`✓ Created partial unique "${INDEX_NAME}".`);

    const after = (await customers.indexes()).find((i: any) => i.name === INDEX_NAME);
    console.log("\nNow:", JSON.stringify(after));

    if (!isAlreadyMigrated(after)) {
        throw new Error("Index did not end up in the expected shape — investigate before continuing.");
    }
    console.log("\n✅ Done.");

    await mongoose.disconnect();
};

run().catch(async (err) => {
    console.error("\n❌ Migration failed:", err);
    if (dropped) {
        // The only genuinely dangerous state: the old index is gone and the new
        // one was not created, so phone uniqueness is briefly unenforced. Say so
        // loudly — recoverable by re-running, not by ignoring.
        console.error(
            "\n⚠ THE OLD INDEX WAS ALREADY DROPPED and the new one was not created.\n" +
            "  Phone uniqueness is NOT enforced on this environment right now.\n" +
            "  Re-run with -- --apply to finish."
        );
    } else {
        console.error("\nNothing was changed — the failure happened before any index was touched.");
    }
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});
