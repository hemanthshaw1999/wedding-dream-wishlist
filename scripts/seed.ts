import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { configuredDatabaseUrl, grantRuntime, migrate, openDatabase } from "../src/server/database.ts";
import { WishlistStore } from "../src/server/store.ts";
import { validateWishlist } from "../src/lib/wishlist.ts";

process.env.DEMO_MODE = "local-only";
if (process.argv.includes("--reset-synthetic-demo")) {
  if (process.env.DATABASE_URL || process.env.APP_ENV === "production") throw new Error("Reset refuses externally configured databases.");
  const path = resolve("data", "local-postgres.json");
  const config = JSON.parse(readFileSync(path, "utf8")) as { environment: string; adminUrl: string; migrationUrl: string; applicationUrl: string };
  if (config.environment !== "synthetic-demo-only") throw new Error("Synthetic marker missing.");
  const admin = openDatabase(config.adminUrl);
  const current = new URL(config.applicationUrl).pathname.slice(1);
  const name = `wishlist_demo_${randomBytes(12).toString("hex")}`;
  try {
    const active = await admin.get("SELECT numbackends FROM pg_stat_database WHERE datname=$1", [current]);
    if (Number(active?.numbackends) !== 0) throw new Error("Stop the app before resetting its synthetic database.");
    await admin.run(`CREATE DATABASE "${name}" OWNER wishlist_migrator`);
    const migrationUrl = new URL(config.migrationUrl); migrationUrl.pathname = `/${name}`;
    const applicationUrl = new URL(config.applicationUrl); applicationUrl.pathname = `/${name}`;
    const fresh = openDatabase(migrationUrl.toString());
    try { await migrate(fresh, "synthetic-demo-only"); await grantRuntime(fresh, "wishlist_app"); }
    finally { await fresh.close(); }
    config.migrationUrl = migrationUrl.toString(); config.applicationUrl = applicationUrl.toString();
    writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 });
    console.log("Switched to a fresh synthetic PostgreSQL database. The old database was preserved, not deleted.");
  } finally { await admin.close(); }
}
const db = openDatabase(configuredDatabaseUrl());
try {
  const marker = await db.get("SELECT value FROM app_metadata WHERE key='environment'");
  if (marker?.value !== "synthetic-demo-only") throw new Error("Seed refuses a non-synthetic database.");
  if (!await db.get("SELECT id FROM wishlists WHERE slug='tara-and-arjun'")) {
    const owner = "fictional-owner";
    await db.run("INSERT INTO users VALUES($1,'fictional-demo',$2) ON CONFLICT(id) DO NOTHING", [owner, new Date().toISOString()]);
    const store = new WishlistStore(db);
    const wishlist = await store.create(owner, validateWishlist({
      displayNames: "Tara & Arjun (fictional)",
      story: "Two curious hearts, one new chapter. This fictional wishlist helps us imagine the experiences we might share. Your presence would always be enough.",
      slug: "tara-and-arjun", visibility: "unlisted", weddingDate: "2027-02-14",
      goals: [
        { title: "Our honeymoon", description: "A few quiet days discovering somewhere new, together.", target: "300000" },
        { title: "A home full of stories", description: "A cosy reading corner for our first home.", target: "50000" }
      ]
    }));
    await store.transition(wishlist.id, owner, "published", wishlist.version);
    console.log("Seeded fictional wishlist: /w/tara-and-arjun. Demo - no real money.");
  } else console.log("Fictional seed already exists; no data changed.");
} finally { await db.close(); }
