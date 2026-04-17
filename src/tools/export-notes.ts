import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { load } from "cheerio";
import TurndownService from "turndown";
import { mkdir } from "node:fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { navigateWithRetry } from "../browser.js";
import { parseCourseSections, parseCourseTitle, parseSectionTabs } from "../parsers/course.js";
import type { CourseSection } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPORTS_DIR = path.join(__dirname, "..", "..", "exports");
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

const READABLE_TYPES = new Set(["page", "resource", "url", "book", "folder", "label"]);

function slug(s: string, max = 80): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[^\w\s\-]+/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, max) || "untitled"
  );
}

async function renderSection(sec: CourseSection): Promise<string> {
  let out = `# Section ${sec.sectionNumber}: ${sec.title}\n\n`;
  if (sec.summary) out += `${sec.summary}\n\n`;

  for (const item of sec.items) {
    out += `\n## [${item.type}] ${item.name}\n`;
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
  return out;
}

async function getCourseData(courseId: string) {
  const courseUrl = `https://elearning.ut.ac.id/course/view.php?id=${courseId}`;
  const { html } = await navigateWithRetry(courseUrl);
  const $ = load(html);
  const title = parseCourseTitle($);

  const sectionsByNum = new Map<number, CourseSection>();
  for (const s of parseCourseSections(html)) sectionsByNum.set(s.sectionNumber, s);

  // Handle UT tab format: fetch each section URL separately
  const allNums = parseSectionTabs(html, courseId);
  for (const n of allNums) {
    if (sectionsByNum.has(n)) continue;
    try {
      const { html: secHtml } = await navigateWithRetry(`${courseUrl}&section=${n}`);
      for (const s of parseCourseSections(secHtml)) {
        if (!sectionsByNum.has(s.sectionNumber)) sectionsByNum.set(s.sectionNumber, s);
      }
    } catch {
      // continue
    }
  }

  const sections = [...sectionsByNum.values()].sort((a, b) => a.sectionNumber - b.sectionNumber);
  return { title, sections, courseUrl };
}

export function registerExportNotes(server: McpServer): void {
  server.tool(
    "export_notes",
    "Ekspor seluruh materi baca dari satu mata kuliah ke folder terorganisir: exports/<NamaCourse>/<NN-section>.md, plus README.md index. Kuis & tugas tidak diekspor.",
    {
      courseId: z.string().describe("ID mata kuliah"),
    },
    async ({ courseId }) => {
      try {
        const { title, sections, courseUrl } = await getCourseData(courseId);
        const courseFolder = path.join(EXPORTS_DIR, `${slug(title)}-${courseId}`);
        await mkdir(courseFolder, { recursive: true });

        const files: { file: string; section: string }[] = [];

        for (const sec of sections) {
          const fname = `${String(sec.sectionNumber).padStart(2, "0")}-${slug(sec.title, 60)}.md`;
          const fpath = path.join(courseFolder, fname);
          const md = await renderSection(sec);
          await Bun.write(fpath, md);
          files.push({ file: fname, section: sec.title });
        }

        let index = `# ${title}\n\n`;
        index += `- Course ID: ${courseId}\n`;
        index += `- URL: <${courseUrl}>\n`;
        index += `- Diekspor: ${new Date().toISOString()}\n\n`;
        index += `## Daftar Section\n\n`;
        for (const f of files) index += `- [${f.section}](./${f.file})\n`;
        await Bun.write(path.join(courseFolder, "README.md"), index);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  courseId,
                  title,
                  folder: courseFolder,
                  sectionFiles: files.length,
                  files,
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

export function registerExportSection(server: McpServer): void {
  server.tool(
    "export_section",
    "Ekspor SATU section mata kuliah ke file markdown di folder course-nya.",
    {
      courseId: z.string().describe("ID mata kuliah"),
      section: z.number().int().describe("Nomor section yang akan diekspor"),
    },
    async ({ courseId, section }) => {
      try {
        const { title, sections } = await getCourseData(courseId);
        const sec = sections.find((s) => s.sectionNumber === section);
        if (!sec) {
          return {
            content: [{ type: "text", text: `Section ${section} tidak ditemukan di course ${courseId}` }],
            isError: true,
          };
        }

        const courseFolder = path.join(EXPORTS_DIR, `${slug(title)}-${courseId}`);
        await mkdir(courseFolder, { recursive: true });
        const fname = `${String(sec.sectionNumber).padStart(2, "0")}-${slug(sec.title, 60)}.md`;
        const fpath = path.join(courseFolder, fname);
        const md = await renderSection(sec);
        await Bun.write(fpath, md);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ courseId, section, title: sec.title, file: fpath }, null, 2),
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
