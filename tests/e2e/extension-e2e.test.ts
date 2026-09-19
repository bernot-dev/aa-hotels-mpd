import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';

const projectRoot = path.resolve(__dirname, '../../');
const fixturesDir = path.resolve(projectRoot, 'fixtures');

interface TestFixtures {
  context: BrowserContext;
  serverUrl: string;
}

export const test = base.extend<TestFixtures>({
  serverUrl: async ({}, use) => {
    const searchHtml = fs.readFileSync(path.join(fixturesDir, 'search-authenticated.html'), 'utf-8');
    const mapHtml = fs.readFileSync(path.join(fixturesDir, 'search-map-authenticated.html'), 'utf-8');

    const server = http.createServer((req, res) => {
      const url = req.url || '';
      if (url.includes('/rest/aadvantage-hotels') || url.includes('/search/results')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            searchResult: {
              results: [
                {
                  hotel: { id: '12498' },
                  economics: {
                    total: { amount: 1702 },
                    rewardAmount: 17020,
                    rewardAmountTiered: 17020,
                  },
                },
                {
                  hotel: { id: '20286' },
                  economics: {
                    total: { amount: 1605 },
                    rewardAmount: 8025,
                    rewardAmountTiered: 11235,
                  },
                },
                {
                  hotel: { id: '465' },
                  economics: {
                    total: { amount: 5081 },
                    rewardAmount: 15243,
                    rewardAmountTiered: 15243,
                  },
                },
              ],
            },
          })
        );
        return;
      }
      if (url.includes('view=map')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(mapHtml);
        return;
      }
      if (url.includes('/search')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(searchHtml);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as any).port;

    await use(`http://127.0.0.1:${port}`);

    server.close();
  },

  context: async ({ serverUrl }, use) => {
    const port = new URL(serverUrl).port;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-ext-'));

    // Chrome extensions require headless: false with --headless=new in args
    const context = await chromium.launchPersistentContext(tmpDir, {
      headless: false,
      args: [
        '--headless=new',
        `--disable-extensions-except=${projectRoot}`,
        `--load-extension=${projectRoot}`,
        `--host-resolver-rules=MAP www.aadvantagehotels.com 127.0.0.1:${port}`,
      ],
    });

    await use(context);
    await context.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  },
});

export const expect = test.expect;

test.describe('AA Hotels MPD Extension E2E Suite', () => {
  test('search list view renders MPD summary banner and hotel card badges', async ({ context }) => {
    const page = await context.newPage();

    // Abort external third-party tracking scripts to prevent React crashes on static fixtures
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (
        url.includes('cloudfront.net') ||
        url.includes('googletagmanager') ||
        url.includes('hotjar') ||
        url.includes('cookielaw') ||
        url.includes('doubleclick') ||
        url.includes('google-analytics') ||
        url.includes('maps.googleapis.com')
      ) {
        await route.abort();
        return;
      }
      await route.continue();
    });

    await page.goto(
      'http://www.aadvantagehotels.com/search?adults=2&checkIn=10%2F04%2F2026&checkOut=10%2F10%2F2026&currency=USD',
      { waitUntil: 'domcontentloaded' }
    );

    // 1. Verify summary banner is injected by the extension
    const summaryBanner = page.locator('#aa-mpd-search-summary');
    await expect(summaryBanner).toBeVisible({ timeout: 10000 });
    await expect(summaryBanner).toContainText('Best earn rate on this page:');
    await expect(summaryBanner).toContainText('17.5 miles/$');

    // 2. Verify hotel cards receive MPD badges
    const badges = page.locator('.aa-mpd-badge');
    await expect(badges.first()).toBeVisible({ timeout: 5000 });
    const badgeCount = await badges.count();
    expect(badgeCount).toBeGreaterThanOrEqual(42);
  });

  test('map view resolves pins and recolors them via network interception', async ({ context }) => {
    const page = await context.newPage();

    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (
        url.includes('cloudfront.net') ||
        url.includes('googletagmanager') ||
        url.includes('hotjar') ||
        url.includes('cookielaw') ||
        url.includes('doubleclick') ||
        url.includes('google-analytics') ||
        url.includes('maps.googleapis.com')
      ) {
        await route.abort();
        return;
      }
      await route.continue();
    });

    await page.goto('http://www.aadvantagehotels.com/search?view=map', {
      waitUntil: 'domcontentloaded',
    });

    // 1. Verify map pins are initially present
    const pin12498 = page.locator('[data-testid="hotel-pin-12498"]');
    await expect(pin12498).toBeVisible({ timeout: 10000 });

    // 2. Trigger fetch request to search API in MAIN world
    // MAIN world interceptor monkey-patches window.fetch, parses response,
    // and dispatches event to ISOLATED content script.
    await page.evaluate(async () => {
      await fetch('http://www.aadvantagehotels.com/rest/aadvantage-hotels/search/results');
    });

    // 3. Verify intercepted pins receive data-aa-mpd attribute and normalized color
    await expect(pin12498).toHaveAttribute('data-aa-mpd', '10.0', { timeout: 5000 });

    const pin465 = page.locator('[data-testid="hotel-pin-465"]');
    await expect(pin465).toHaveAttribute('data-aa-mpd', '3.0', { timeout: 5000 });

    // 4. Verify pin styles:
    // Pin 12498 (10.0 MPD, best) must be forest green
    const pin12498Bg = await pin12498.evaluate((el) => el.style.backgroundColor);
    expect(pin12498Bg).toBe('rgb(21, 128, 61)');

    // Pin 465 (3.0 MPD, worst) must be crimson red
    const pin465Bg = await pin465.evaluate((el) => el.style.backgroundColor);
    expect(pin465Bg).toBe('rgb(185, 28, 28)');

    // 5. Verify summary banner is visible and reflects the highest rate (10.0 miles/$)
    const summaryBanner = page.locator('#aa-mpd-search-summary');
    await expect(summaryBanner).toBeVisible({ timeout: 5000 });
    await expect(summaryBanner).toContainText('10.0 miles/$');

    // 6. Save visual artifact
    const screenshotDir = path.resolve(projectRoot, 'artifacts');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    await page.screenshot({
      path: path.join(screenshotDir, 'e2e-map-resolved.png'),
    });
  });
});
