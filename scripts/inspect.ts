import { navigateWithRetry, closeBrowser, getPage } from "../src/browser.js";
import { load } from "cheerio";
import { mkdir } from "node:fs/promises";

const URL = process.argv[2] || "https://elearning.ut.ac.id/course/view.php?id=268883&section=1";

await mkdir("./exports", { recursive: true });

console.error("[inspect] Navigating to:", URL);
let { html } = await navigateWithRetry(URL);

// If redirected to login, wait for user to log in manually
if (html.includes('id="loginform"') || html.includes("login/index.php")) {
  console.error("\n[inspect] ⚠️  Belum login. Browser terbuka — silakan login manual.");
  console.error("[inspect] Setelah login berhasil dan halaman course termuat, tekan ENTER di terminal ini...\n");
  const page = await getPage();
  await new Promise<void>((res) => process.stdin.once("data", () => res()));
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60_000 });
  html = await page.content();
}

await Bun.write("./exports/_inspect_full.html", html);

const $ = load(html);
const region = $("#region-main").html() || $("main").html() || "";
await Bun.write("./exports/_inspect_region.html", region);

// Structural report
const report: string[] = [];
report.push("=== SELECTOR HITS ===\n");

const selectors = [
  "li.section",
  "section.course-section",
  "div.course-section",
  "[data-sectionid]",
  "[data-for='section']",
  ".sectionname",
  "h3.sectionname",
  "[data-for='section_title']",
  "li.activity",
  ".activity-item",
  "li.modtype_quiz",
  "li.modtype_resource",
  "li.modtype_url",
  "li.modtype_page",
  "a[href*='/mod/']",
  ".instancename",
  ".contentafterlink",
];
for (const sel of selectors) {
  report.push(`${sel.padEnd(36)} → ${$(sel).length}`);
}

report.push("\n=== FIRST SECTION OUTER HTML (truncated 4000) ===\n");
const firstSection =
  $("li.section").first().get(0) ||
  $("section.course-section").first().get(0) ||
  $("[data-for='section']").first().get(0) ||
  $("[data-sectionid]").first().get(0);
if (firstSection) {
  const outer = $.html(firstSection);
  report.push(outer.slice(0, 4000));
} else {
  report.push("(tidak ada kecocokan section)");
}

report.push("\n=== FIRST ACTIVITY OUTER HTML (truncated 2000) ===\n");
const firstActivity =
  $("li.activity").first().get(0) ||
  $(".activity-item").first().get(0) ||
  $("li[class*='modtype_']").first().get(0);
if (firstActivity) {
  report.push($.html(firstActivity).slice(0, 2000));
} else {
  report.push("(tidak ada kecocokan activity)");
}

report.push("\n=== UNIQUE CLASSES ON SECTION-LIKE ELEMENTS (sample) ===\n");
const classBag = new Set<string>();
$("li[class*='section'], section[class*='section'], [data-for='section']").each((_, el) => {
  ($(el).attr("class") || "").split(/\s+/).forEach((c) => c && classBag.add(c));
});
report.push([...classBag].sort().join("\n"));

const out = report.join("\n");
await Bun.write("./exports/_inspect_report.txt", out);

console.error("\n[inspect] Files tersimpan di exports/:");
console.error("  - _inspect_full.html    (full page)");
console.error("  - _inspect_region.html  (region-main only)");
console.error("  - _inspect_report.txt   (structural summary)\n");
console.error(out);

await closeBrowser();
process.exit(0);
