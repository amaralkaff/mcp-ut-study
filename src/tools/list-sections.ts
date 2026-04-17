import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { load } from "cheerio";
import { navigateWithRetry } from "../browser.js";
import { parseCourseSections, parseCourseTitle, parseSectionTabs } from "../parsers/course.js";
import type { CourseSection } from "../types.js";

export function registerListSections(server: McpServer): void {
  server.tool(
    "list_sections",
    "Daftar section/minggu pada satu mata kuliah beserta aktivitas. Mendukung format tab UT (multi-URL per section).",
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
        const { html: homeHtml } = await navigateWithRetry(base);
        const $home = load(homeHtml);
        const title = parseCourseTitle($home);

        // Detect all section numbers from tab navigation
        const allSectionNums = parseSectionTabs(homeHtml, courseId);

        // Single-section request
        if (section !== undefined) {
          const url = `${base}&section=${section}`;
          const { html } = await navigateWithRetry(url);
          const parsed = parseCourseSections(html);
          const target = parsed.find((s) => s.sectionNumber === section) || parsed[0];
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { courseId, title, sectionCount: target ? 1 : 0, sections: target ? [target] : [] },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // All sections: parse home + fetch each tab separately
        const home = parseCourseSections(homeHtml);
        const sectionsByNum = new Map<number, CourseSection>();
        for (const s of home) sectionsByNum.set(s.sectionNumber, s);

        const numsToFetch = allSectionNums.filter((n) => !sectionsByNum.has(n));
        for (const n of numsToFetch) {
          try {
            const { html } = await navigateWithRetry(`${base}&section=${n}`);
            const parsed = parseCourseSections(html);
            for (const s of parsed) {
              if (!sectionsByNum.has(s.sectionNumber)) sectionsByNum.set(s.sectionNumber, s);
            }
          } catch {
            // continue
          }
        }

        const sections = [...sectionsByNum.values()].sort(
          (a, b) => a.sectionNumber - b.sectionNumber
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  courseId,
                  title,
                  detectedSectionNumbers: allSectionNums,
                  sectionCount: sections.length,
                  sections,
                },
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
