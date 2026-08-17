// Usage: node screenshot.mjs <url> <outputPath>
// Takes a full-page screenshot of the running dev server so the Telegram
// approval message shows what the fix actually looks like.
import { chromium } from "playwright";

const [, , url, outputPath] = process.argv;

if (!url || !outputPath) {
  console.error("Usage: node screenshot.mjs <url> <outputPath>");
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
// Give client-side intro animations / preloaders time to finish so the
// screenshot shows the actual app, not a loading splash screen.
await page.waitForTimeout(3000);
// Full-page (not just the viewport) so a fix anywhere on the page — footer,
// below the fold, etc. — is actually visible in the screenshot.
await page.screenshot({ path: outputPath, fullPage: true });
await browser.close();
