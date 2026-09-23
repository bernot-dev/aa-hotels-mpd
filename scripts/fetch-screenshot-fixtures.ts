// Fetches guest search, map, and details pages with a real browser and saves them as screenshot fixtures,
// with the site's runtime CSS-in-JS rules written into the HTML (see serializeDocumentWithStyles).
// Plain HTML scrapes (Firecrawl, outerHTML) lose those rules and render unstyled offline.
import { chromium, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { serializeDocumentWithStyles } from '../src/debug';

const projectRoot = path.resolve(__dirname, '../');
const fixturesDir = path.resolve(projectRoot, 'fixtures');

// seamless_auth=1 skips the redirect to AA's SSO login, which blocks automated browsers.
const commonParams =
  'adults=2&checkIn=10%2F04%2F2026&checkOut=10%2F10%2F2026&children=0&currency=USD&language=en' +
  '&latitude=36.163934&locationType=CITY&longitude=-115.146332&mode=earn&numberOfChildren=0' +
  '&placeId=AGODA_CITY%7C17072&program=aadvantage&query=Las%20Vegas%20(NV)%2C%20United%20States' +
  '&rea=true&rooms=1&sort=milesHighest&source=AGODA&seamless_auth=1';

const SEARCH_URL = `https://www.aadvantagehotels.com/search?${commonParams}`;
const DETAILS_URL = `https://www.aadvantagehotels.com/details?id=23025005&${commonParams}`;

async function clickAll(page: Page, pattern: RegExp) {
  const buttons = page.getByRole('button', { name: pattern });
  const count = await buttons.count();
  for (let i = 0; i < count; i++) {
    await buttons.nth(i).click().catch(() => {});
  }
  return count;
}

async function save(page: Page, filename: string) {
  const html: string = await page.evaluate(`(${serializeDocumentWithStyles.toString()})(document)`);
  fs.writeFileSync(path.join(fixturesDir, filename), html, 'utf-8');
  const ruleChars = Array.from(html.matchAll(/<style[^>]*\bdata-(?:emotion|styled)\b[^>]*>([\s\S]*?)<\/style>/g))
    .reduce((sum, [, body]) => sum + body.trim().length, 0);
  console.log(`Saved ${filename} (${(html.length / 1024).toFixed(0)} KB, ${(ruleChars / 1024).toFixed(0)} KB CSS-in-JS)`);
}

async function main() {
  fs.mkdirSync(fixturesDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log('Fetching search page...');
  await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('[data-testid^="hotel-card-"]').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(3000);
  await save(page, 'search-screenshot.html');

  console.log('Opening map view...');
  await page.getByTestId('map-toggle-button').first().click();
  await page.locator('[data-testid^="hotel-pin-"]').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await save(page, 'search-map-screenshot.html');

  console.log('Fetching details page...');
  await page.goto(DETAILS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('[data-testid="room-group"]').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(3000);
  await clickAll(page, /^Show \d+ more rooms?$/);
  await page.waitForTimeout(1500);
  await clickAll(page, /^Show all room rates$/);
  await page.waitForTimeout(2000);
  await save(page, 'details-screenshot.html');

  await browser.close();
}

main().catch((err) => {
  console.error('Fixture fetch failed:', err);
  process.exit(1);
});
