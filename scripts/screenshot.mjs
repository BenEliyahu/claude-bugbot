// Usage: node screenshot.mjs <url> <outputPath> [selector]
// Takes a screenshot of the running dev server so the Telegram approval
// message shows what the fix actually looks like. If `selector` is given,
// screenshots just that element (scrolled into view); otherwise captures
// the full page.
import { chromium } from "playwright";

const [, , url, outputPath, selector] = process.argv;

if (!url || !outputPath) {
  console.error("Usage: node screenshot.mjs <url> <outputPath> [selector]");
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

// Wait for images to finish loading, and give client-side intro
// animations/preloaders time to finish, before capturing anything.
await page
  .waitForFunction(() => Array.from(document.images).every((img) => img.complete), {
    timeout: 15000,
  })
  .catch(() => {}); // a slow/broken image shouldn't fail the whole run
await page.waitForTimeout(3000);

if (selector) {
  try {
    const locator = page.locator(selector).first();
    await locator.scrollIntoViewIfNeeded({ timeout: 5000 });
    await page.waitForTimeout(500); // let scroll-triggered animations settle
    await locator.screenshot({ path: outputPath });
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.warn(`Could not screenshot selector "${selector}", falling back to full page: ${err.message}`);
  }
}

await page.screenshot({ path: outputPath, fullPage: true });
await browser.close();
