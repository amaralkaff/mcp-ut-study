import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { load } from "cheerio";
import { navigateWithRetry } from "../browser.js";

const LOGIN_URL = "https://elearning.ut.ac.id/login/index.php";

export function registerLogin(server: McpServer): void {
  server.tool(
    "login",
    "Login ke elearning.ut.ac.id (Moodle) dengan NIM dan password.",
    {
      username: z.string().describe("NIM / username UT"),
      password: z.string().describe("Password akun UT"),
    },
    async ({ username, password }) => {
      try {
        const { page } = await navigateWithRetry(LOGIN_URL);

        await page.type('input[name="username"]', username, { delay: 60 });
        await page.type('input[name="password"]', password, { delay: 60 });

        await Promise.all([
          page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30_000 }),
          page.click('button[type="submit"], #loginbtn, input[type="submit"]'),
        ]);

        const html = await page.content();
        const $ = load(html);

        const loggedIn = $('a[href*="login/logout.php"]').length > 0;

        if (!loggedIn) {
          const error =
            $("#loginerrormessage").text().trim() ||
            $(".loginerrors, .alert-danger").first().text().trim() ||
            "Login gagal — periksa NIM/password";
          return {
            content: [
              { type: "text", text: JSON.stringify({ success: false, error }, null, 2) },
            ],
            isError: true,
          };
        }

        const fullName = $(".usermenu .usertext, .userbutton .usertext").first().text().trim();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, fullName: fullName || username }, null, 2),
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
