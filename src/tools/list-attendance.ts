import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { load } from "cheerio";
import { navigateWithRetry } from "../browser.js";
import type { AttendanceSession } from "../types.js";

/**
 * Read-only: hanya membaca status kehadiran yang sudah tercatat.
 * Tidak menandai "present" atau melakukan aksi kehadiran apa pun.
 */
export function registerListAttendance(server: McpServer): void {
  server.tool(
    "list_attendance_sessions",
    "Baca daftar sesi kehadiran (mod/attendance) beserta status yang sudah tercatat. Read-only — tidak menandai hadir.",
    {
      url: z
        .string()
        .url()
        .describe("URL aktivitas attendance, contoh https://elearning.ut.ac.id/mod/attendance/view.php?id=..."),
    },
    async ({ url }) => {
      try {
        const { html } = await navigateWithRetry(url);
        const $ = load(html);

        const sessions: AttendanceSession[] = [];
        const $rows = $("table.attwidth tbody tr, table.generaltable tbody tr");

        const headers: string[] = [];
        $("table.attwidth thead th, table.generaltable thead th").each((_, th) => {
          headers.push($(th).text().trim().toLowerCase());
        });

        $rows.each((_, row) => {
          const cells = $(row).find("td").map((__, td) => $(td).text().trim()).get();
          if (cells.length === 0) return;

          const pick = (keys: string[]): string | undefined => {
            for (const key of keys) {
              const idx = headers.findIndex((h) => h.includes(key));
              if (idx >= 0 && cells[idx]) return cells[idx];
            }
            return undefined;
          };

          sessions.push({
            date: pick(["date", "tanggal"]) || cells[0] || "",
            time: pick(["time", "waktu"]),
            type: pick(["type", "tipe"]),
            description: pick(["description", "deskripsi"]),
            status: pick(["status"]),
            remarks: pick(["remarks", "catatan"]),
          });
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { url, count: sessions.length, sessions, note: "Read-only — tidak menandai hadir." },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
