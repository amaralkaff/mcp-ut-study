import path from "path";

export interface ItemProgress {
  name: string;
  type: string;
  url: string;
  done: boolean;
  exportedAt?: string;
  downloadedFile?: string;
  extractedChars?: number;
  note?: string;
}

export interface SectionProgress {
  sectionNumber: number;
  title: string;
  done: boolean;
  exportedAt?: string;
  items: ItemProgress[];
}

export interface CourseProgress {
  courseId: string;
  title: string;
  courseUrl: string;
  updatedAt: string;
  sections: SectionProgress[];
}

export function progressPath(folder: string): string {
  return path.join(folder, ".progress.json");
}

export async function loadProgress(folder: string): Promise<CourseProgress | null> {
  try {
    const f = Bun.file(progressPath(folder));
    if (await f.exists()) return (await f.json()) as CourseProgress;
  } catch {}
  return null;
}

export async function saveProgress(folder: string, p: CourseProgress): Promise<void> {
  await Bun.write(progressPath(folder), JSON.stringify(p, null, 2));
}

export function renderChecklist(p: CourseProgress): string {
  let md = `# ${p.title}\n\n`;
  md += `- Course ID: ${p.courseId}\n`;
  md += `- URL: <${p.courseUrl}>\n`;
  md += `- Terakhir diperbarui: ${p.updatedAt}\n\n`;

  const totalItems = p.sections.reduce((n, s) => n + s.items.length, 0);
  const doneItems = p.sections.reduce(
    (n, s) => n + s.items.filter((i) => i.done).length,
    0
  );
  const pct = totalItems ? Math.round((doneItems / totalItems) * 100) : 0;
  md += `**Progress: ${doneItems}/${totalItems} item (${pct}%)**\n\n`;

  md += `## Checklist Section\n\n`;
  for (const sec of p.sections) {
    const box = sec.done ? "[x]" : "[ ]";
    const fileLink = `./${String(sec.sectionNumber).padStart(2, "0")}-${slug(sec.title)}.md`;
    md += `- ${box} **Section ${sec.sectionNumber}: ${sec.title}** — [file](${fileLink})\n`;
    for (const it of sec.items) {
      const ibox = it.done ? "[x]" : "[ ]";
      const extra: string[] = [];
      if (it.downloadedFile) extra.push(`📎 ${path.basename(it.downloadedFile)}`);
      if (it.extractedChars) extra.push(`📝 ${it.extractedChars} karakter teks`);
      if (it.note) extra.push(`⚠️ ${it.note}`);
      md += `  - ${ibox} [${it.type}] ${it.name}${extra.length ? " — " + extra.join(" · ") : ""}\n`;
    }
  }
  return md;
}

export function slug(s: string, max = 60): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[^\w\s\-]+/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, max) || "untitled"
  );
}
