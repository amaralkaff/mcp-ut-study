import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { load } from "cheerio";
import { navigateWithRetry } from "../browser.js";
import type { CourseSummary } from "../types.js";

const DASHBOARD = "https://elearning.ut.ac.id/my/courses.php";

export function registerListCourses(server: McpServer): void {
  server.tool(
    "list_courses",
    "Daftar mata kuliah yang diambil di akun Moodle UT. Butuh sesi login.",
    {},
    async () => {
      try {
        const { html } = await navigateWithRetry(DASHBOARD);
        const $ = load(html);

        const courses: CourseSummary[] = [];
        const seen = new Set<string>();

        $('a[href*="/course/view.php?id="]').each((_, el) => {
          const href = $(el).attr("href") || "";
          const match = href.match(/id=(\d+)/);
          if (!match) return;
          const id = match[1];
          if (seen.has(id)) return;

          const name = $(el).text().trim() || $(el).find(".coursename, .multiline").text().trim();
          if (!name) return;

          seen.add(id);
          courses.push({
            id,
            name,
            url: `https://elearning.ut.ac.id/course/view.php?id=${id}`,
          });
        });

        return {
          content: [
            { type: "text", text: JSON.stringify({ count: courses.length, courses }, null, 2) },
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
