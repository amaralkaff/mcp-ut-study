import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { load } from "cheerio";
import { navigateWithRetry, getPage } from "../browser.js";

const MYUT_LOGIN = "https://myut.ut.ac.id/auth/login/v2";
const ELEARNING_HOME = "https://elearning.ut.ac.id/my/";

export function registerLogin(server: McpServer): void {
  server.tool(
    "login",
    "Buka halaman login MyUT (SSO) di browser. Anda login sendiri di jendela itu — password TIDAK dikirim via chat. Setelah selesai login di browser, panggil tool ini LAGI dengan done=true untuk verifikasi & simpan cookie.",
    {
      done: z
        .boolean()
        .optional()
        .describe(
          "Set true HANYA setelah Anda selesai login manual di browser. Tool akan verifikasi sesi ke elearning.ut.ac.id."
        ),
      waitSeconds: z
        .number()
        .int()
        .min(10)
        .max(600)
        .optional()
        .describe("Alternatif: tunggu N detik agar Anda login di browser, lalu auto-verifikasi. Default: tidak menunggu."),
    },
    async ({ done, waitSeconds }) => {
      try {
        if (!done && !waitSeconds) {
          await navigateWithRetry(MYUT_LOGIN);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "browser_opened",
                    url: MYUT_LOGIN,
                    next: "Login manual di jendela Chrome yang terbuka. Setelah selesai, panggil login lagi dengan { done: true }.",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        if (waitSeconds) {
          await navigateWithRetry(MYUT_LOGIN);
          await new Promise((res) => setTimeout(res, waitSeconds * 1000));
        }

        const page = await getPage();
        await page.goto(ELEARNING_HOME, { waitUntil: "networkidle2", timeout: 60_000 });
        const html = await page.content();
        const $ = load(html);

        const loggedIn =
          $('a[href*="login/logout.php"]').length > 0 ||
          $(".usermenu .usertext, .userbutton .usertext").first().text().trim().length > 0;

        if (!loggedIn) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    error:
                      "Belum terdeteksi login di elearning.ut.ac.id. Pastikan Anda selesai login di MyUT dan halaman sudah redirect, lalu panggil lagi dengan { done: true }.",
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        const fullName = $(".usermenu .usertext, .userbutton .usertext").first().text().trim();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, fullName: fullName || undefined }, null, 2),
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
