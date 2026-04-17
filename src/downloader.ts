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
async function cookieHeader(page: Awaited<ReturnType<typeof getPage>>, url: string): Promise<string> {
  const cookies = await page.cookies(url);
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function fetchAuthenticated(
  url: string,
  page: Awaited<ReturnType<typeof getPage>>
): Promise<{ buffer: Buffer; mimeType: string; filename: string; finalUrl: string }> {
  const cookies = await cookieHeader(page, url);
  const userAgent = await page.evaluate(() => navigator.userAgent);
  const res = await fetch(url, {
    headers: {
      Cookie: cookies,
      "User-Agent": userAgent,
      Accept: "*/*",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} dari ${url}`);

  const contentType = res.headers.get("content-type") || "application/octet-stream";
  const mimeType = contentType.split(";")[0].trim();
  const finalUrl = res.url;

  let filename = "";
  const disposition = res.headers.get("content-disposition");
  if (disposition) {
    const m = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i);
    if (m) filename = decodeURIComponent(m[1]);
  }
  if (!filename) {
    filename = decodeURIComponent(new URL(finalUrl).pathname.split("/").pop() || "download");
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, mimeType, filename, finalUrl };
}

export async function downloadResource(
  url: string,
  outDir: string
): Promise<DownloadedFile> {
  await mkdir(outDir, { recursive: true });
  const page = await getPage();

  // Step 1: if it's a Moodle /mod/resource/ URL, open page and find the real pluginfile link
  let targetUrl = url;
  if (url.includes("/mod/resource/view.php")) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const html = await page.content();
    const match =
      html.match(/<object[^>]+data="([^"]+pluginfile\.php[^"]+)"/i) ||
      html.match(/<iframe[^>]+src="([^"]+pluginfile\.php[^"]+)"/i) ||
      html.match(/href="([^"]+pluginfile\.php[^"]+)"/i);
    if (match) {
      targetUrl = match[1].replace(/&amp;/g, "&");
    } else {
      // Moodle "force download" — resource view may auto-redirect; get final URL
      const finalUrl = page.url();
      if (finalUrl !== url && finalUrl.includes("pluginfile.php")) {
        targetUrl = finalUrl;
      } else {
        throw new Error(`Tidak menemukan tautan file di resource page: ${url}`);
      }
    }
  }

  // Step 2: fetch via authenticated fetch to get raw bytes
  const { buffer, mimeType, filename: rawName, finalUrl } = await fetchAuthenticated(targetUrl, page);
  const filename = sanitizeFilename(rawName);
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
