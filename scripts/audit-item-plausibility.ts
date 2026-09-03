/**
 * READ-ONLY audit: item lines whose weight/rate pair cannot be real, across
 * every shop. Writes nothing.
 *
 *   NODE_ENV=dev  npx tsx scripts/audit-item-plausibility.ts
 *   NODE_ENV=prod npx tsx scripts/audit-item-plausibility.ts
 *   NODE_ENV=prod npx tsx scripts/audit-item-plausibility.ts --all   (include deleted)
 *
 * Written on 2026-08-13 after shop 9740423690's bills were investigated by hand,
 * which took an afternoon and an admin impersonation session. The answer — two
 * shops, four active bills, all gold — is a thirty-second query. It should not
 * have needed an investigation, and next time it will not.
 *
 * Deliberately mirrors `gold-khata-book-frontend/src/utils/itemPlausibility.ts`. The
 * bounds are duplicated rather than shared because the two repos ship
 * separately; if you change one, change the other, and the tests in
 * `__tests__/itemPlausibility.test.ts` are the reference for what the classes
 * mean.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config({ path: `.env.${process.env.NODE_ENV}` });
dotenv.config();

const { NODE_ENV, DEV_DB_URL, PREPROD_DB_URL, PROD_DB_URL } = process.env;

const getMongoURI = (): string => {
  switch (NODE_ENV) {
    case "dev": return DEV_DB_URL as string;
    case "preprod": return PREPROD_DB_URL as string;
    case "prod": return PROD_DB_URL as string;
    default: throw new Error("NODE_ENV must be dev | preprod | prod");
  }
};

type Metal = "Gold" | "Silver";

/** Kept in step with the app's METAL_BOUNDS. */
const BOUNDS: Record<Metal, { rateMin: number; rateMax: number; weightMax: number }> = {
  Gold: { rateMin: 300, rateMax: 40000, weightMax: 300 },
  Silver: { rateMin: 5, rateMax: 900, weightMax: 5000 },
};

const SCALE = 1000;
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const metalOf = (it: any): Metal =>
  /silver/i.test(String(it.itemType ?? "")) || /silver/i.test(String(it.purity ?? ""))
    ? "Silver"
    : "Gold";

type Kind = "scaled-pair" | "rate-too-low" | "rate-too-high" | "weight-too-high";

const classify = (it: any): { kind: Kind; metal: Metal; w: number; r: number } | null => {
  const metal = metalOf(it);
  const b = BOUNDS[metal];
  // Orders store net weight as `weight`; invoices as `netWeight`.
  const w = num(it.netWeight ?? it.weight);
  const r = num(it.rate);
  if (w <= 0 || r <= 0) return null;

  const rateLow = r < b.rateMin;
  const rateHigh = r > b.rateMax;
  const weightHigh = w > b.weightMax;

  // Order matters: a compensated pair trips the rate and weight tests
  // individually too, and naming the rate sends the shopkeeper to the wrong
  // field — which is exactly the mistake that produced this data.
  if (rateLow && weightHigh && w / SCALE <= b.weightMax && r * SCALE >= b.rateMin)
    return { kind: "scaled-pair", metal, w, r };
  if (rateHigh) return { kind: "rate-too-high", metal, w, r };
  if (rateLow) return { kind: "rate-too-low", metal, w, r };
  if (weightHigh) return { kind: "weight-too-high", metal, w, r };
  return null;
};

async function run() {
  const includeDeleted = process.argv.includes("--all");
  const uri = getMongoURI();
  if (!uri) throw new Error("MongoDB URI missing for " + NODE_ENV);

  await mongoose.connect(uri);
  console.log(`connected [${NODE_ENV}] — READ ONLY${includeDeleted ? " (including deleted)" : ""}\n`);

  const db = mongoose.connection.db!;
  const shops = await db.collection("dukandars").find({}).toArray();
  const byId = new Map(shops.map(s => [String(s._id), s]));

  const filter = includeDeleted ? {} : { deletedAt: null };
  const perShop = new Map<string, { docs: Set<string>; kinds: Record<string, number>; metals: Record<Metal, Set<string>> }>();
  let scanned = 0;

  for (const [collection, ownerField, numberField] of [
    ["invoices", "userId", "invoiceNumber"],
    ["orders", "dukandarId", "orderNumber"],
  ] as const) {
    for (const doc of await db.collection(collection).find(filter).toArray()) {
      scanned++;
      const owner = String(doc[ownerField] ?? doc.userId ?? doc.dukandarId ?? "");
      for (const it of (doc.items || [])) {
        const hit = classify(it);
        if (!hit) continue;
        if (!perShop.has(owner)) {
          perShop.set(owner, { docs: new Set(), kinds: {}, metals: { Gold: new Set(), Silver: new Set() } });
        }
        const bucket = perShop.get(owner)!;
        const label = `${doc[numberField] ?? doc._id}`;
        bucket.docs.add(label);
        bucket.metals[hit.metal].add(label);
        const key = `${hit.kind}/${hit.metal}`;
        bucket.kinds[key] = (bucket.kinds[key] || 0) + 1;
      }
    }
  }

  console.log(`scanned ${scanned} documents across ${shops.length} shops`);
  console.log(`${perShop.size} shop(s) with at least one impossible line\n`);

  let gold = 0, silver = 0;
  for (const [owner, b] of [...perShop.entries()].sort((a, z) => z[1].docs.size - a[1].docs.size)) {
    const shop = byId.get(owner);
    gold += b.metals.Gold.size;
    silver += b.metals.Silver.size;
    console.log(
      `${String(shop?.phone ?? owner).padEnd(14)} ${String(shop?.shopName || "(no shop name)").slice(0, 24).padEnd(26)}` +
      `${b.docs.size} bill(s)   GOLD ${b.metals.Gold.size}  SILVER ${b.metals.Silver.size}`
    );
    console.log(`    ${Object.entries(b.kinds).map(([k, v]) => `${k}=${v}`).join("  ")}`);
    console.log(`    ${[...b.docs].join(", ")}`);
  }

  console.log(`\nTOTAL affected bills — GOLD ${gold}  SILVER ${silver}`);
  await mongoose.disconnect();
}

run().catch(e => { console.error("❌ Failed:", e); process.exit(1); });
