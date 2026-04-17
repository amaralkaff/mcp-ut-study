import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { load } from "cheerio";
import { navigateWithRetry } from "../browser.js";
import { parseCourseSections, parseCourseTitle } from "../parsers/course.js";

export function registerListSections(server: McpServer): void {
  server.tool(
    "list_sections",
    "Daftar section/minggu pada satu mata kuliah beserta aktivitas (materi, kuis, tugas, dll).",
    {
      courseId: z.string().describe("ID mata kuliah, contoh: 268883"),
      section: z
        .number()
        .int()
        .optional()
        .describe("Nomor section tertentu (opsional). Kosongkan untuk semua."),
    },
    async ({ courseId, section }) => {
      try {
        const base = `https://elearning.ut.ac.id/course/view.php?id=${courseId}`;
        const url = section !== undefined ? `${base}&section=${section}` : base;
        const { html } = await navigateWithRetry(url);
        const $ = load(html);

        const title = parseCourseTitle($);
        const sections = parseCourseSections(html);
        const filtered = section !== undefined
          ? sections.filter((s) => s.sectionNumber === section)
          : sections;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { courseId, title, sectionCount: filtered.length, sections: filtered },
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
