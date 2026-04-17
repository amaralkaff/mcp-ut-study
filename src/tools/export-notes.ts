import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { load } from "cheerio";
import TurndownService from "turndown";
import { mkdir } from "node:fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { navigateWithRetry } from "../browser.js";
import { parseCourseSections, parseCourseTitle } from "../parsers/course.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPORTS_DIR = path.join(__dirname, "..", "..", "exports");
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

const READABLE_TYPES = new Set(["page", "resource", "url", "book", "folder", "label"]);

export function registerExportNotes(server: McpServer): void {
  server.tool(
    "export_notes",
    "Ekspor seluruh materi baca (page/resource/url/book/label) dari satu mata kuliah ke file markdown untuk belajar offline. Kuis & tugas TIDAK diekspor.",
    {
      courseId: z.string().describe("ID mata kuliah"),
    },
    async ({ courseId }) => {
      try {
        await mkdir(EXPORTS_DIR, { recursive: true });

        const courseUrl = `https://elearning.ut.ac.id/course/view.php?id=${courseId}`;
        const { html } = await navigateWithRetry(courseUrl);
        const $ = load(html);
        const title = parseCourseTitle($);
        const sections = parseCourseSections(html);

        let out = `# ${title}\n\n_Course ID: ${courseId}_\n_Diekspor: ${new Date().toISOString()}_\n\n`;

        for (const sec of sections) {
          out += `\n---\n\n## Section ${sec.sectionNumber}: ${sec.title}\n\n`;
          if (sec.summary) out += `${sec.summary}\n\n`;

          for (const item of sec.items) {
            out += `\n### [${item.type}] ${item.name}\n`;
            out += `<${item.url}>\n\n`;

            if (!READABLE_TYPES.has(item.type)) continue;

            try {
              const { html: mat } = await navigateWithRetry(item.url);
              const $m = load(mat);
              const region = $m("#region-main [role='main']").html() || $m("#region-main").html() || "";
              const $region = load(region);
              $region("script, style, nav, .secondary-navigation, .activity-navigation").remove();
              const md = turndown.turndown($region.html() || "").trim();
              if (md) out += `${md}\n\n`;
            } catch (e) {
              out += `_(gagal membaca: ${e instanceof Error ? e.message : String(e)})_\n\n`;
            }
          }
        }

        const safeTitle = title.replace(/[^\w\-]+/g, "_").slice(0, 80) || `course-${courseId}`;
        const filePath = path.join(EXPORTS_DIR, `${safeTitle}-${courseId}.md`);
        await Bun.write(filePath, out);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { courseId, title, sections: sections.length, filePath, bytes: out.length },
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
