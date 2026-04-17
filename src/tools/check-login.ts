import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { load } from "cheerio";
import { navigateWithRetry } from "../browser.js";

const HOME = "https://elearning.ut.ac.id/my/";

export function registerCheckLogin(server: McpServer): void {
  server.tool(
    "check_login",
    "Cek apakah sesi Moodle UT saat ini sudah login. Mengembalikan status dan nama pengguna bila ada.",
    {},
    async () => {
      try {
        const { html } = await navigateWithRetry(HOME);
        const $ = load(html);

        const logoutLink = $('a[href*="login/logout.php"]').length > 0;
        const userMenu = $(".usermenu .userbutton, .userbutton .usertext").first().text().trim();
        const fullName = userMenu || $(".usermenu .usertext").first().text().trim();

        const loggedIn = logoutLink || fullName.length > 0;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ loggedIn, fullName: fullName || undefined }, null, 2),
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
