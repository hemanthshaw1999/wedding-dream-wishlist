import { csvCell } from "@/lib/claims";
import { AppError } from "@/lib/errors";
import { apiError, requireOwner } from "@/server/http";
import { getDatabase } from "@/server/database";
import { WishlistStore } from "@/server/store";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const owner = await requireOwner();
    const id = (await context.params).id;
    const db = getDatabase();
    new WishlistStore(db).getOwner(id, owner);
    if (Number(db.prepare("SELECT COUNT(*) AS count FROM contributions WHERE wishlist_id=?").get(id)?.count) > 5000) {
      throw new AppError(409, "EXPORT_LIMIT", "Export exceeds the demo's 5,000-row limit. No partial export was produced.");
    }
    const rows = db.prepare(`SELECT id,guest_name,guest_message,reference,amount_paise,status,created_at
      FROM contributions WHERE wishlist_id=? ORDER BY created_at,id`).all(id);
    const lines = [
      ["Report ID", "Private guest name", "Private message", "Reference (not proof)", "Amount INR", "Status (demo)", "Created UTC"],
      ...rows.map((row) => [String(row.id), String(row.guest_name), String(row.guest_message), String(row.reference),
        (Number(row.amount_paise) / 100).toFixed(2), String(row.status), String(row.created_at)])
    ].map((line) => line.map(csvCell).join(",")).join("\r\n");
    return new Response(`\uFEFF${lines}\r\n`, { headers: {
      "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store",
      "Content-Disposition": 'attachment; filename="private-demo-reports.csv"'
    } });
  } catch (error) { return apiError(error); }
}
