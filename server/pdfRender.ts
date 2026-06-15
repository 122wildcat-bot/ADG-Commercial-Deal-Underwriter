// server/pdfRender.ts
//
// Puppeteer wrapper for HTML → PDF. Pattern mirrors PVG
// (/home/user/Property-Valuation-Generator-/src/lib/pdf.ts): single shared
// browser instance, reconnect on crash, `--no-sandbox` for Railway containers,
// `networkidle2` (not networkidle0 — a slow Google Fonts response would hang
// the render), 15s ceiling, optional running footer.
//
// Chromium is installed via the Dockerfile (`apt-get install chromium`) and
// pointed at via PUPPETEER_EXECUTABLE_PATH. Local dev needs the same env var
// set to a local Chromium binary, or Puppeteer's bundled one.

import puppeteer, { type Browser, type LaunchOptions } from "puppeteer";

let browserPromise: Promise<Browser> | null = null;

function launchBrowser(): Promise<Browser> {
  const options: LaunchOptions = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--font-render-hinting=none",
    ],
  };
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (executablePath) options.executablePath = executablePath;
  return puppeteer.launch(options);
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  const browser = await browserPromise;
  // If a previous browser crashed, relaunch on next call.
  if (!browser.connected) {
    browserPromise = null;
    return getBrowser();
  }
  return browser;
}

export interface PdfFooter {
  left: string;
  right: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

export async function renderHtmlToPdf(html: string, footer?: PdfFooter): Promise<Buffer> {
  const tBrowser = Date.now();
  const browser = await getBrowser();
  const page = await browser.newPage();
  const browserMs = Date.now() - tBrowser;
  try {
    const tContent = Date.now();
    await page.setContent(html, { waitUntil: "networkidle2", timeout: 15000 });
    await page.emulateMediaType("print");
    const contentMs = Date.now() - tContent;

    // Running footer rendered by Puppeteer in the bottom margin (not part of
    // the HTML — that would duplicate per section). The footer template runs
    // in an isolated context with no access to the page's fonts, so a generic
    // sans stack is required.
    const footerTemplate = footer
      ? `<div style="width:100%;box-sizing:border-box;font-size:7.5px;font-family:Helvetica,Arial,sans-serif;color:#8a8a8a;padding:0 0.5in;display:flex;justify-content:space-between;">` +
        `<span>${escapeHtml(footer.left)}</span><span>${escapeHtml(footer.right)}</span></div>`
      : "<div></div>";

    const tPdf = Date.now();
    const pdf = await page.pdf({
      format: "letter",
      printBackground: true,
      displayHeaderFooter: Boolean(footer),
      headerTemplate: "<div></div>",
      footerTemplate,
      margin: { top: "0.5in", right: "0.5in", bottom: footer ? "0.6in" : "0.5in", left: "0.5in" },
    });
    const pdfMs = Date.now() - tPdf;
    console.log(`[puppeteer] browser_ready=${browserMs}ms set_content=${contentMs}ms pdf=${pdfMs}ms`);
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

/** Slugify a string for use in a Content-Disposition filename. */
export function slugifyForFilename(s: string): string {
  return (s || "deal")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "deal";
}
