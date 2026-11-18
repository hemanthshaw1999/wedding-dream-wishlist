import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase } from "../src/server/database.ts";
import { WishlistStore } from "../src/server/store.ts";
import { validateWishlist } from "../src/lib/wishlist.ts";

const defaultPath = resolve("data", "synthetic-demo.sqlite");
const path = process.env.WISHLIST_DB_PATH || defaultPath;
if (process.argv.includes("--reset-synthetic-demo")) {
  if (path !== defaultPath) throw new Error("Reset is limited to data\\synthetic-demo.sqlite. Stop the local server first.");
  if (existsSync(path)) {
    const check = openDatabase(path);
    check.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      if (existsSync(`${path}${suffix}`)) unlinkSync(`${path}${suffix}`);
    }
  }
}
const db = openDatabase(path);
try {
  if (!db.prepare("SELECT id FROM wishlists WHERE slug='tara-and-arjun'").get()) {
    const owner = "fictional-owner";
    db.prepare("INSERT OR IGNORE INTO users VALUES(?,'fictional-demo',?)").run(owner, new Date().toISOString());
    const store = new WishlistStore(db);
    const wishlist = store.create(owner, validateWishlist({
      displayNames: "Tara & Arjun (fictional)",
      story: "Two curious hearts, one new chapter. This fictional wishlist helps us imagine the experiences we might share. Your presence would always be enough.",
      slug: "tara-and-arjun",
      visibility: "unlisted",
      weddingDate: "2027-02-14",
      goals: [
        { title: "Our honeymoon", description: "A few quiet days discovering somewhere new, together.", target: "300000" },
        { title: "A home full of stories", description: "A cosy reading corner for our first home.", target: "50000" }
      ]
    }));
    store.transition(wishlist.id, owner, "published", wishlist.version);
    console.log("Seeded fictional wishlist: /w/tara-and-arjun. Demo - no real money.");
  } else console.log("Fictional seed already exists; no data changed.");
} finally { db.close(); }
