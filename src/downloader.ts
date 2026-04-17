import { mkdir } from "node:fs/promises";
import path from "path";
import { getPage, navigateWithRetry } from "./browser.js";

export interface DownloadedFile {
  filePath: string;
  fileName: string;
  mimeType: string;
  bytes: number;
  sourceUrl: string;
  finalUrl: string;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\/\\?%*:|"<>]/g, "_").replace(/\s+/g, "_").slice(0, 150);
}

/**
 * Download a file from a Moodle resource URL. Uses the authenticated puppeteer
 * session to follow any redirects and grab the final file.
 */
export async function downloadResource(
  url: string,
  outDir: string
): Promise<DownloadedFile> {
  await mkdir(outDir, { recursive: true });
  const page = await getPage();

  // Capture the final URL + response headers by intercepting
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (!response) throw new Error(`No response for ${url}`);

  const finalUrl = response.url();
  const headers = response.headers();
  const contentType = headers["content-type"] || "application/octet-stream";
  const mimeType = contentType.split(";")[0].trim();

  // If it's an HTML page (Moodle viewer), look for embedded file link
  if (mimeType.includes("html")) {
    const html = await page.content();
    // Moodle resource viewer embeds: <object data="..."> or <iframe src="..."> or <a href="...pluginfile.php">
    const match =
      html.match(/<object[^>]+data="([^"]+pluginfile\.php[^"]+)"/i) ||
      html.match(/<iframe[^>]+src="([^"]+pluginfile\.php[^"]+)"/i) ||
      html.match(/href="([^"]+pluginfile\.php[^"]+)"/i);
    if (match) {
      // Decode HTML entities in URL
      const embedUrl = match[1].replace(/&amp;/g, "&");
      return downloadResource(embedUrl, outDir);
    }
    throw new Error(`Resource appears HTML-only (no embedded file): ${url}`);
  }

  // Extract filename from Content-Disposition or URL
  let filename = "";
  const disposition = headers["content-disposition"];
  if (disposition) {
    const m = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i);
    if (m) filename = decodeURIComponent(m[1]);
  }
  if (!filename) {
    filename = decodeURIComponent(new URL(finalUrl).pathname.split("/").pop() || "download");
  }
  filename = sanitizeFilename(filename);

  // Download via page's authenticated context
  const buffer = await response.buffer();
  const filePath = path.join(outDir, filename);
  await Bun.write(filePath, buffer);

  return {
    filePath,
    fileName: filename,
    mimeType,
    bytes: buffer.length,
    sourceUrl: url,
    finalUrl,
  };
}

/**
 * Extract text from a downloaded PDF/DOCX file.
 * Returns empty string on failure.
 */
export async function extractText(file: DownloadedFile): Promise<string> {
  try {
    if (file.mimeType.includes("pdf")) {
      const mod: any = await import("pdf-parse");
      const pdfParse = mod.default || mod.pdf || mod;
      const buf = await Bun.file(file.filePath).arrayBuffer();
      const data = await pdfParse(Buffer.from(buf));
      return (data.text || "").trim();
    }
    if (
      file.mimeType.includes("wordprocessingml") ||
      file.fileName.toLowerCase().endsWith(".docx")
    ) {
      const mammoth = await import("mammoth");
      const buf = await Bun.file(file.filePath).arrayBuffer();
      const result = await mammoth.extractRawText({ buffer: Buffer.from(buf) });
      return result.value.trim();
    }
    if (file.mimeType.startsWith("text/")) {
      return (await Bun.file(file.filePath).text()).trim();
    }
  } catch (err) {
    console.error("[downloader] Ekstraksi gagal:", err);
  }
  return "";
}
