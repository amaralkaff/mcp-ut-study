import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { mkdir } from "node:fs/promises";
import { closeBrowser } from "./browser.js";

await mkdir("./exports", { recursive: true }).catch(() => {});

import { registerCheckLogin } from "./tools/check-login.js";
import { registerLogin } from "./tools/login.js";
import { registerListCourses } from "./tools/list-courses.js";
import { registerListSections } from "./tools/list-sections.js";
import { registerReadMaterial } from "./tools/read-material.js";
import { registerListAssessments } from "./tools/list-assessments.js";
import { registerGetQuizQuestions } from "./tools/get-quiz-questions.js";
import { registerListAttendance } from "./tools/list-attendance.js";
import { registerExportNotes, registerExportSection } from "./tools/export-notes.js";

const server = new McpServer({
  name: "ut-study-assistant",
  version: "0.1.0",
});

registerCheckLogin(server);
registerLogin(server);
registerListCourses(server);
registerListSections(server);
registerReadMaterial(server);
registerListAssessments(server);
registerGetQuizQuestions(server);
registerListAttendance(server);
registerExportNotes(server);
registerExportSection(server);

async function shutdown() {
  console.error("[server] Mematikan...");
  await closeBrowser();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => closeBrowser());

const transport = new StdioServerTransport();
await server.connect(transport);

console.error("[server] MCP UT Study-Assistant siap (ut-study-mcp-server)");
