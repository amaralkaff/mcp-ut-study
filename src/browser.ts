import { connect } from "puppeteer-real-browser";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIES_PATH = path.join(__dirname, "..", "cookies.json");
const NAV_TIMEOUT = 30_000;
const NAV_TIMEOUT_RETRY = 60_000;

const ALLOWED_HOSTS = new Set(["elearning.ut.ac.id"]);

export function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`URL tidak valid: ${url}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Skema URL diblokir: ${parsed.protocol}`);
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`Host diblokir: ${parsed.hostname} — hanya elearning.ut.ac.id yang diizinkan`);
  }
}

type BrowserInstance = {
  browser: Awaited<ReturnType<typeof connect>>["browser"];
  page: Awaited<ReturnType<typeof connect>>["page"];
};

let instance: BrowserInstance | null = null;

async function loadCookies(page: BrowserInstance["page"]): Promise<void> {
  try {
    const file = Bun.file(COOKIES_PATH);
    if (await file.exists()) {
      const cookies = await file.json();
      if (Array.isArray(cookies) && cookies.length > 0) {
        await page.setCookie(...cookies);
        console.error("[browser] Cookies dimuat dari", COOKIES_PATH);
      }
    }
  } catch (err) {
    console.error("[browser] Gagal memuat cookies (mulai baru):", err);
  }
}

async function saveCookies(page: BrowserInstance["page"]): Promise<void> {
  try {
    const cookies = await page.cookies();
    await Bun.write(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  } catch (err) {
    console.error("[browser] Gagal menyimpan cookies:", err);
  }
}

async function launchBrowser(): Promise<BrowserInstance> {
  console.error("[browser] Menjalankan Chrome...");
  const { browser, page } = await connect({
    headless: false,
    turnstile: true,
    args: [],
    customConfig: {},
    connectOption: { defaultViewport: null },
    disableXvfb: false,
  });

  browser.on("disconnected", () => {
    console.error("[browser] Browser terputus");
    instance = null;
  });

  await loadCookies(page);
  return { browser, page };
}

export async function getPage(): Promise<BrowserInstance["page"]> {
  if (!instance) instance = await launchBrowser();
  return instance.page;
}

export async function ensureFreshBrowser(): Promise<BrowserInstance["page"]> {
  if (instance) {
    try {
      await instance.browser.close();
    } catch {}
    instance = null;
  }
  instance = await launchBrowser();
  return instance.page;
}

function isDetachedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return (
    msg.includes("Detached Frame") ||
    msg.includes("Execution context was destroyed") ||
    msg.includes("Target closed") ||
    msg.includes("Session closed")
  );
}

export async function navigateWithRetry(
  url: string
): Promise<{ page: BrowserInstance["page"]; html: string }> {
  validateUrl(url);
  let page = await getPage();
  let retried = false;

  const attempt = async (timeout: number): Promise<string> => {
    await page.goto(url, { waitUntil: "networkidle2", timeout });
    const html = await page.content();
    await saveCookies(page);
    return html;
  };

  try {
    const html = await attempt(NAV_TIMEOUT);
    return { page, html };
  } catch (err) {
    if (isDetachedError(err) && !retried) {
      console.error("[browser] Detached frame, relaunching...");
      retried = true;
      page = await ensureFreshBrowser();
      const html = await attempt(NAV_TIMEOUT_RETRY);
      return { page, html };
    }
    throw err;
  }
}

export async function closeBrowser(): Promise<void> {
  if (instance) {
    try {
      await instance.browser.close();
    } catch {}
    instance = null;
  }
}
