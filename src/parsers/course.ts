import { load, type CheerioAPI } from "cheerio";
import type { CourseSection, SectionItem } from "../types.js";

const MOD_TYPE_REGEX = /\/mod\/([a-z]+)\//i;

function detectType(href: string): string {
  const m = href.match(MOD_TYPE_REGEX);
  return m ? m[1] : "unknown";
}

export function parseCourseSections(html: string): CourseSection[] {
  const $ = load(html);
  const sections: CourseSection[] = [];

  $("li.section, .course-section, section.course-section").each((_, el) => {
    const $sec = $(el);
    const sectionNumber = Number($sec.attr("data-sectionid") || $sec.attr("data-section") || "0");
    const title =
      $sec.find(".sectionname, h3.sectionname").first().text().trim() ||
      $sec.find("[data-for='section_title']").first().text().trim() ||
      `Section ${sectionNumber}`;
    const summary = $sec.find(".summary, .course-section-summary").first().text().trim();
    const sectionUrl = $sec.find("a.section-link").attr("href") || "";

    const items: SectionItem[] = [];
    $sec.find("li.activity, .activity-item, li.modtype_quiz, li.modtype_resource").each((__, act) => {
      const $act = $(act);
      const link = $act.find('a[href*="/mod/"]').first();
      const href = link.attr("href") || "";
      if (!href) return;
      const name =
        link.find(".instancename").clone().children(".accesshide").remove().end().text().trim() ||
        link.text().trim();
      if (!name) return;
      const modIdMatch = href.match(/id=(\d+)/);
      items.push({
        name,
        type: detectType(href),
        url: href,
        modId: modIdMatch ? modIdMatch[1] : undefined,
        summary: $act.find(".contentafterlink, .description").first().text().trim() || undefined,
      });
    });

    sections.push({ sectionNumber, title, summary: summary || undefined, items, url: sectionUrl });
  });

  return sections;
}

export function parseCourseTitle($: CheerioAPI): string {
  return (
    $("h1.page-header-headings, header h1, .page-header-headings h1").first().text().trim() ||
    $("title").text().split("|")[0].trim()
  );
}
