import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { load } from "cheerio";
import { navigateWithRetry } from "../browser.js";
import { parseCourseSections } from "../parsers/course.js";
import type { AssessmentInfo } from "../types.js";

const ASSESSMENT_TYPES = new Set(["quiz", "assign", "workshop", "lesson"]);

export function registerListAssessments(server: McpServer): void {
  server.tool(
    "list_assessments",
    "Daftar kuis/tugas/penilaian dalam satu mata kuliah beserta metadata (batas waktu, percobaan, nilai). Read-only.",
    {
      courseId: z.string().describe("ID mata kuliah"),
    },
    async ({ courseId }) => {
      try {
        const url = `https://elearning.ut.ac.id/course/view.php?id=${courseId}`;
        const { html } = await navigateWithRetry(url);
        const sections = parseCourseSections(html);

        const assessments: AssessmentInfo[] = [];

        for (const sec of sections) {
          for (const item of sec.items) {
            if (!ASSESSMENT_TYPES.has(item.type)) continue;

            const info: AssessmentInfo = {
              name: `[${sec.title}] ${item.name}`,
              url: item.url,
              type: item.type,
            };

            try {
              const { html: detailHtml } = await navigateWithRetry(item.url);
              const $ = load(detailHtml);

              const text = $("#region-main").text();
              const grab = (label: RegExp): string | undefined => {
                const m = text.match(label);
                return m ? m[1].trim() : undefined;
              };

              info.opens = grab(/Opened?:\s*([^\n]+)/i) || grab(/Dibuka:\s*([^\n]+)/i);
              info.closes = grab(/Closes?:\s*([^\n]+)/i) || grab(/Ditutup:\s*([^\n]+)/i);
              info.timeLimit = grab(/Time limit:\s*([^\n]+)/i) || grab(/Batas waktu:\s*([^\n]+)/i);
              info.attemptsAllowed =
                grab(/Attempts allowed:\s*([^\n]+)/i) || grab(/Percobaan[^:]*:\s*([^\n]+)/i);
              info.grade = grab(/Grade:\s*([^\n]+)/i) || grab(/Nilai[^:]*:\s*([^\n]+)/i);
            } catch {
              // continue — metadata optional
            }

            assessments.push(info);
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ courseId, count: assessments.length, assessments }, null, 2),
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
