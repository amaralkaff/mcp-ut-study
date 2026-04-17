import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { load } from "cheerio";
import TurndownService from "turndown";
import { navigateWithRetry } from "../browser.js";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

export function registerReadMaterial(server: McpServer): void {
  server.tool(
    "read_material",
    "Baca isi materi (page, resource, url, book, folder) dan kembalikan sebagai markdown bersih untuk dipelajari.",
    {
      url: z
        .string()
        .url()
        .describe("URL aktivitas Moodle, contoh https://elearning.ut.ac.id/mod/page/view.php?id=123"),
    },
    async ({ url }) => {
      try {
        const { html } = await navigateWithRetry(url);
        const $ = load(html);

        const title =
          $("h2.urlhead, .page-header-headings h1, header h1").first().text().trim() ||
          $("title").text().split("|")[0].trim();

        const region =
          $("#region-main [role='main']").html() ||
          $("#region-main").html() ||
          $("main").html() ||
          $("body").html() ||
          "";

        const $region = load(region);
        $region("script, style, nav, .secondary-navigation, .activity-navigation").remove();
        const cleaned = $region.html() || "";

        const markdown = turndown.turndown(cleaned).trim();

        const attachments: { name: string; url: string }[] = [];
        $("#region-main a[href*='pluginfile.php'], #region-main a.resourcelinkdetails").each((_, el) => {
          const href = $(el).attr("href");
          if (!href) return;
          const name = $(el).text().trim() || href.split("/").pop() || "file";
          attachments.push({ name, url: href });
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { url, title, contentMarkdown: markdown, attachments },
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
