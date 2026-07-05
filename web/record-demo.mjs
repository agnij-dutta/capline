// Record the Capline Control Room "instant burner demo" against localnet.
// Drives the real UI headlessly and captures video of: provision a live mandate
// → legit payment SETTLES → jailbreak overpay REVERTS → jailbreak scammer REVERTS.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = "marketing/assets/rec";
mkdirSync(OUT, { recursive: true });
const size = { width: 1280, height: 800 };

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: size,
  deviceScaleFactor: 2,
  recordVideo: { dir: OUT, size },
});
const page = await context.newPage();

const settleWait = 30000;
page.setDefaultTimeout(40000);

await page.goto("http://localhost:3100/app", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

// 1. provision a live mandate (burner)
await page.getByRole("button", { name: /Instant demo/ }).click();
// wait until the mandate card is live (the settlement actions appear)
await page.getByRole("button", { name: /Legit payment/ }).waitFor({ timeout: settleWait });
await page.waitForTimeout(1400);

// 2. honest payment settles
await page.getByRole("button", { name: /Legit payment/ }).click();
await page.getByText("SETTLED").first().waitFor({ timeout: settleWait });
await page.waitForTimeout(1000);

// 3. jailbroken: overpay 1000 → reverts
await page.getByRole("button", { name: /Obey injection: overpay/ }).click();
await page.getByText("REVERTED").first().waitFor({ timeout: settleWait });
await page.waitForTimeout(1000);

// 4. jailbroken: pay scammer → reverts
await page.getByRole("button", { name: /Obey injection: new payee/ }).click();
// wait for a second REVERTED row
await page.waitForFunction(
  () => document.querySelectorAll("*").length > 0 &&
        (document.body.innerText.match(/REVERTED/g) || []).length >= 2,
  { timeout: settleWait },
);
await page.waitForTimeout(2200);

await context.close(); // finalizes the video file
await browser.close();
console.log("done");
