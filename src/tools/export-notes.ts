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
import { downloadResource, extractText } from "../downloader.js";
import {
  loadProgress,
  saveProgress,
  renderChecklist,
  slug,
  type CourseProgress,
  type SectionProgress,
  type ItemProgress,
} from "../progress.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPORTS_DIR = path.join(__dirname, "..", "..", "exports");
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

const READABLE_TYPES = new Set(["page", "resource", "url", "book", "folder", "label"]);
const DOWNLOADABLE_TYPES = new Set(["resource", "url", "folder"]);

async function getCourseData(courseId: string) {
  const courseUrl = `https://elearning.ut.ac.id/course/view.php?id=${courseId}`;
  const { html } = await navigateWithRetry(courseUrl);
  const $ = load(html);
  const title = parseCourseTitle($);

  const sectionsByNum = new Map<number, CourseSection>();
  for (const s of parseCourseSections(html)) sectionsByNum.set(s.sectionNumber, s);

  const allNums = parseSectionTabs(html, courseId);
  for (const n of allNums) {
    if (sectionsByNum.has(n)) continue;
    try {
      const { html: secHtml } = await navigateWithRetry(`${courseUrl}&section=${n}`);
      for (const s of parseCourseSections(secHtml)) {
        if (!sectionsByNum.has(s.sectionNumber)) sectionsByNum.set(s.sectionNumber, s);
      }
    } catch {}
  }

  const sections = [...sectionsByNum.values()].sort((a, b) => a.sectionNumber - b.sectionNumber);
  return { title, sections, courseUrl };
}

async function processItem(
  item: { name: string; type: string; url: string },
  filesDir: string,
  existingProgress?: ItemProgress
): Promise<{ progress: ItemProgress; markdown: string }> {
  // Already done — skip
  if (existingProgress?.done) {
    return {
      progress: existingProgress,
      markdown: `\n### ✅ [${item.type}] ${item.name}\n<${item.url}>\n\n_(sudah diekspor sebelumnya)_\n`,
    };
  }

  let md = `\n### [${item.type}] ${item.name}\n<${item.url}>\n\n`;
  const prog: ItemProgress = {
    name: item.name,
    type: item.type,
    url: item.url,
    done: false,
    exportedAt: new Date().toISOString(),
  };

  // Try file download first for file-backed activities
  if (DOWNLOADABLE_TYPES.has(item.type)) {
    try {
      const file = await downloadResource(item.url, filesDir);
      prog.downloadedFile = file.filePath;
      md += `📎 **File:** \`${file.fileName}\` (${file.mimeType}, ${(file.bytes / 1024).toFixed(1)} KB)\n\n`;

      const text = await extractText(file);
      if (text) {
        prog.extractedChars = text.length;
        md += `#### Isi teks (diekstrak):\n\n${text}\n\n`;
      } else {
        prog.note = "file diunduh tapi teks tidak bisa diekstrak";
        md += `_(teks tidak dapat diekstrak — cek file langsung)_\n\n`;
      }
      prog.done = true;
      return { progress: prog, markdown: md };
    } catch (err) {
      prog.note = `download gagal: ${err instanceof Error ? err.message : String(err)}`;
      md += `_(download gagal: ${prog.note})_\n\n`;
      // Fall through to HTML read
    }
  }

  // HTML read for pages / fallback
  if (READABLE_TYPES.has(item.type)) {
    try {
      const { html } = await navigateWithRetry(item.url);
      const $m = load(html);
      const region = $m("#region-main [role='main']").html() || $m("#region-main").html() || "";
      const $region = load(region);
      $region("script, style, nav, .secondary-navigation, .activity-navigation").remove();
      const text = turndown.turndown($region.html() || "").trim();
      if (text) {
        md += `${text}\n\n`;
        prog.extractedChars = text.length;
        prog.done = true;
      } else {
        prog.note = "halaman kosong";
      }
    } catch (err) {
      prog.note = `baca halaman gagal: ${err instanceof Error ? err.message : String(err)}`;
      md += `_(${prog.note})_\n\n`;
    }
  } else {
    md += `_(tipe ${item.type} tidak diekspor — buka URL langsung)_\n\n`;
    prog.done = true; // acknowledged, nothing to export
  }

  return { progress: prog, markdown: md };
}

async function renderSection(
  sec: CourseSection,
  filesDir: string,
  existing?: SectionProgress
): Promise<{ markdown: string; progress: SectionProgress }> {
  let md = `# Section ${sec.sectionNumber}: ${sec.title}\n\n`;
  if (sec.summary) md += `${sec.summary}\n\n`;

  const itemProgress: ItemProgress[] = [];
  for (const item of sec.items) {
    const prev = existing?.items.find((i) => i.url === item.url);
    const { progress, markdown } = await processItem(item, filesDir, prev);
    itemProgress.push(progress);
    md += markdown;
  }

  const allDone = itemProgress.length > 0 && itemProgress.every((i) => i.done);
  const sectionProgress: SectionProgress = {
    sectionNumber: sec.sectionNumber,
    title: sec.title,
    done: allDone,
    exportedAt: new Date().toISOString(),
    items: itemProgress,
  };
  return { markdown: md, progress: sectionProgress };
}

export function registerExportNotes(server: McpServer): void {
  server.tool(
    "export_notes",
    "Ekspor materi satu mata kuliah: download PDF/DOCX, ekstrak teks, simpan ke folder per-course dengan checklist README.md dan .progress.json. Re-run akan skip item yang sudah done.",
    {
      courseId: z.string().describe("ID mata kuliah"),
      force: z
        .boolean()
        .optional()
        .describe("Paksa ulang ekspor semua item (abaikan progress). Default: false."),
    },
    async ({ courseId, force }) => {
      try {
        const { title, sections, courseUrl } = await getCourseData(courseId);
        const folder = path.join(EXPORTS_DIR, `${slug(title, 80)}-${courseId}`);
        const filesDir = path.join(folder, "files");
        await mkdir(filesDir, { recursive: true });

        const prev = force ? null : await loadProgress(folder);
        const progress: CourseProgress = {
          courseId,
          title,
          courseUrl,
          updatedAt: new Date().toISOString(),
          sections: [],
        };

        const fileSummary: { file: string; section: string; itemsDone: number; itemsTotal: number }[] = [];

        for (const sec of sections) {
          const existing = prev?.sections.find((s) => s.sectionNumber === sec.sectionNumber);
          const { markdown, progress: secProg } = await renderSection(sec, filesDir, existing);
          const fname = `${String(sec.sectionNumber).padStart(2, "0")}-${slug(sec.title)}.md`;
          await Bun.write(path.join(folder, fname), markdown);
          progress.sections.push(secProg);
          fileSummary.push({
            file: fname,
            section: sec.title,
            itemsDone: secProg.items.filter((i) => i.done).length,
            itemsTotal: secProg.items.length,
          });
        }

        await saveProgress(folder, progress);
        await Bun.write(path.join(folder, "README.md"), renderChecklist(progress));

        const totalItems = progress.sections.reduce((n, s) => n + s.items.length, 0);
        const doneItems = progress.sections.reduce(
          (n, s) => n + s.items.filter((i) => i.done).length,
          0
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  courseId,
                  title,
                  folder,
                  sectionCount: progress.sections.length,
                  itemsDone: doneItems,
                  itemsTotal: totalItems,
                  files: fileSummary,
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
    "Ekspor SATU section (termasuk download PDF + ekstrak teks). Update progress checklist.",
    {
      courseId: z.string().describe("ID mata kuliah"),
      section: z.number().int().describe("Nomor section yang akan diekspor"),
      force: z.boolean().optional().describe("Paksa ulang meski sudah done"),
    },
    async ({ courseId, section, force }) => {
      try {
        const { title, sections, courseUrl } = await getCourseData(courseId);
        const sec = sections.find((s) => s.sectionNumber === section);
        if (!sec) {
          return {
            content: [{ type: "text", text: `Section ${section} tidak ditemukan` }],
            isError: true,
          };
        }

        const folder = path.join(EXPORTS_DIR, `${slug(title, 80)}-${courseId}`);
        const filesDir = path.join(folder, "files");
        await mkdir(filesDir, { recursive: true });

        const prev = await loadProgress(folder);
        const existing =
          !force && prev ? prev.sections.find((s) => s.sectionNumber === section) : undefined;

        const { markdown, progress: secProg } = await renderSection(sec, filesDir, existing);
        const fname = `${String(sec.sectionNumber).padStart(2, "0")}-${slug(sec.title)}.md`;
        await Bun.write(path.join(folder, fname), markdown);

        const newProgress: CourseProgress = prev ?? {
          courseId,
          title,
          courseUrl,
          updatedAt: new Date().toISOString(),
          sections: [],
        };
        newProgress.title = title;
        newProgress.courseUrl = courseUrl;
        newProgress.updatedAt = new Date().toISOString();
        const idx = newProgress.sections.findIndex((s) => s.sectionNumber === section);
        if (idx >= 0) newProgress.sections[idx] = secProg;
        else newProgress.sections.push(secProg);
        newProgress.sections.sort((a, b) => a.sectionNumber - b.sectionNumber);

        await saveProgress(folder, newProgress);
        await Bun.write(path.join(folder, "README.md"), renderChecklist(newProgress));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  courseId,
                  section,
                  title: sec.title,
                  file: path.join(folder, fname),
                  itemsDone: secProg.items.filter((i) => i.done).length,
                  itemsTotal: secProg.items.length,
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
