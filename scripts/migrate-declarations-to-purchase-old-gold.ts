/**
 * One-off migration: oldgolddeclarations -> purchaseOldGold.
 *
 * The module was renamed so the record says what it is — a purchase of old gold
 * — leaving the word "declaration" for the document it produces. The collection
 * moved with it, which orphans anything written under the old name.
 *
 * Copies every document across and renumbers DEC-n -> POG-n, keeping _id so any
 * existing references (Order/Invoice links, ImageKit folders) still resolve.
 * Also seeds the new counter key so freshly created records continue the
 * sequence instead of colliding with a migrated POG-1.
 *
 * Usage (from gold-khata-book-backend/):
 *   NODE_ENV=dev npx ts-node scripts/migrate-declarations-to-purchase-old-gold.ts
 *   NODE_ENV=dev npx ts-node scripts/migrate-declarations-to-purchase-old-gold.ts --apply
 *   NODE_ENV=dev npx ts-node scripts/migrate-declarations-to-purchase-old-gold.ts --apply --drop-old
 *
 * --drop-old DELETES the source collection and is deliberately separate from
 * --apply: copy and verify first, drop only once you have looked at the result.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config({ path: `.env.${process.env.NODE_ENV}` });
dotenv.config();

const { NODE_ENV, DEV_DB_URL, PREPROD_DB_URL, PROD_DB_URL } = process.env;

const OLD_COLLECTION = "oldgolddeclarations";
const NEW_COLLECTION = "purchaseOldGold";

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
    const dropOld = process.argv.includes("--drop-old");

    if (dropOld && !apply) {
        throw new Error("--drop-old requires --apply. Copy before you delete.");
    }

    const uri = getMongoURI();
    if (!uri) throw new Error("MongoDB URI is missing in environment variables");

    await mongoose.connect(uri);
    console.log(`✅ Connected [${NODE_ENV}]${apply ? " — APPLY mode" : " — DRY RUN"}`);

    const db = mongoose.connection.db!;
    const existing = (await db.listCollections().toArray()).map((c) => c.name);

    if (!existing.includes(OLD_COLLECTION)) {
        console.log(`Nothing to do — '${OLD_COLLECTION}' does not exist.`);
        await mongoose.disconnect();
        return;
    }

    const docs = await db.collection(OLD_COLLECTION).find({}).toArray();
    console.log(`Found ${docs.length} document(s) in '${OLD_COLLECTION}'.\n`);

    // Guard against running twice: a second copy would duplicate _ids and fail
    // mid-way, leaving the target half-populated.
    const alreadyThere = existing.includes(NEW_COLLECTION)
        ? await db.collection(NEW_COLLECTION).countDocuments()
        : 0;
    if (alreadyThere > 0) {
        console.log(
            `⚠ '${NEW_COLLECTION}' already holds ${alreadyThere} document(s).\n` +
            `  Copying again would collide on _id. Inspect before re-running.`,
        );
        await mongoose.disconnect();
        return;
    }

    let maxSeqByUser = new Map<string, number>();

    const migrated = docs.map((doc: any) => {
        const oldNumber: string = doc.declarationNumber || "";
        const seq = Number(oldNumber.replace(/^DEC-/, "")) || 0;
        const userKey = String(doc.userId);
        maxSeqByUser.set(userKey, Math.max(maxSeqByUser.get(userKey) || 0, seq));

        const newNumber = seq > 0 ? `POG-${seq}` : oldNumber;
        console.log(`  ${oldNumber || "(no number)"} → ${newNumber}`);
        return { ...doc, declarationNumber: newNumber };
    });

    if (!apply) {
        console.log(
            `\nDRY RUN — would copy ${migrated.length} document(s) into '${NEW_COLLECTION}'` +
            `\nand seed counters so new records continue the sequence.` +
            `\nRe-run with --apply to write.`,
        );
        await mongoose.disconnect();
        return;
    }

    if (migrated.length > 0) {
        await db.collection(NEW_COLLECTION).insertMany(migrated);
        console.log(`\n✅ Copied ${migrated.length} document(s) into '${NEW_COLLECTION}'.`);
    }

    // Seed the renamed counter so the next POG number follows the migrated ones
    // rather than restarting at 1 and colliding.
    for (const [userId, seq] of maxSeqByUser) {
        await db.collection("counters").updateOne(
            { id: `purchaseOldGold_${userId}` },
            { $max: { seq } },
            { upsert: true },
        );
        console.log(`   counter purchaseOldGold_${userId} → at least ${seq}`);
    }

    if (dropOld) {
        await db.collection(OLD_COLLECTION).drop();
        console.log(`\n🗑  Dropped '${OLD_COLLECTION}'.`);
    } else {
        console.log(
            `\n'${OLD_COLLECTION}' left in place. Re-run with --drop-old once you ` +
            `have confirmed the copy looks right.`,
        );
    }

    await mongoose.disconnect();
}

run().catch((err) => {
    console.error("❌ Failed:", err);
    process.exit(1);
});
