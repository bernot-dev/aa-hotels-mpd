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
  extensionId: string;
}

export const test = base.extend<TestFixtures>({
  serverUrl: async ({}, use) => {
    const searchHtml = fs.readFileSync(path.join(fixturesDir, 'search-authenticated.html'), 'utf-8');
    const mapHtml = fs.readFileSync(path.join(fixturesDir, 'search-map-authenticated.html'), 'utf-8');
    const detailsHtml = fs.readFileSync(path.join(fixturesDir, 'details-authenticated.html'), 'utf-8');

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
      if (url.includes('/details')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(detailsHtml);
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

  extensionId: async ({ context }, use) => {
    let worker = context.serviceWorkers()[0];
    if (!worker) {
      worker = await context.waitForEvent('serviceworker', { timeout: 5000 });
    }
    const extensionId = new URL(worker.url()).hostname;
    await use(extensionId);
  },
});

export const expect = test.expect;

// Helper to block external telemetry and analytics scripts in tests
async function setupPageRoutes(page: any) {
  await page.route('**/*', async (route: any) => {
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
}

test.describe('AA Hotels MPD Extension E2E Suite', () => {
  test('1. Search list view (/search): renders MPD summary banner, hotel card badges, and export button', async ({
    context,
  }) => {
    const page = await context.newPage();
    await setupPageRoutes(page);

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

    // 3. Verify debug DOM export button is mounted
    const debugBtn = page.locator('#aa-mpd-debug-btn');
    await expect(debugBtn).toBeVisible({ timeout: 5000 });
    await expect(debugBtn).toContainText('Export Fixture');

    // 4. Save visual artifact
    const screenshotDir = path.resolve(projectRoot, 'artifacts');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    await page.screenshot({
      path: path.join(screenshotDir, 'e2e-search-list-resolved.png'),
    });
  });

  test('2. Search map view (/search?view=map): resolves pins and recolors them via network interception', async ({
    context,
  }) => {
    const page = await context.newPage();
    await setupPageRoutes(page);

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

  test('3. Hotel details view (/details): renders room rates summary banner, room card badges, and export button', async ({
    context,
  }) => {
    const page = await context.newPage();
    await setupPageRoutes(page);

    await page.goto(
      'http://www.aadvantagehotels.com/details?hotelId=12498&checkIn=10%2F04%2F2026&checkOut=10%2F10%2F2026&currency=USD',
      { waitUntil: 'domcontentloaded' }
    );

    // 1. Verify details summary banner is injected
    const detailsSummary = page.locator('#aa-mpd-details-summary');
    await expect(detailsSummary).toBeVisible({ timeout: 10000 });
    await expect(detailsSummary).toContainText('Best earn rate on this page:');
    await expect(detailsSummary).toContainText('3.7 miles/$');

    // 2. Verify room rate cards receive MPD badges (81 unboosted base rate cards)
    const badges = page.locator('.aa-mpd-badge');
    await expect(badges.first()).toBeVisible({ timeout: 5000 });
    const badgeCount = await badges.count();
    expect(badgeCount).toBe(81);

    // 3. Verify debug DOM export button is mounted
    const debugBtn = page.locator('#aa-mpd-debug-btn');
    await expect(debugBtn).toBeVisible({ timeout: 5000 });
    await expect(debugBtn).toContainText('Export Fixture');

    // 4. Save visual artifact
    const screenshotDir = path.resolve(projectRoot, 'artifacts');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    await page.screenshot({
      path: path.join(screenshotDir, 'e2e-details-resolved.png'),
    });
  });

  test('4. Extension options page (options.html): persists configuration changes to chrome.storage.sync', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();

    // Navigate to unpacked Chrome extension options page
    await page.goto(`chrome-extension://${extensionId}/options.html`);

    await expect(page).toHaveTitle('AA Hotels MPD Options');

    // Verify all 5 setting checkboxes are present
    const expandRoomRates = page.locator('#expandRoomRates');
    const expandRoomTypes = page.locator('#expandRoomTypes');
    const expandSearchResults = page.locator('#expandSearchResults');
    const includeBonusMiles = page.locator('#includeBonusMiles');
    const showDebugButton = page.locator('#showDebugButton');

    await expect(expandRoomRates).toBeAttached();
    await expect(expandRoomTypes).toBeAttached();
    await expect(expandSearchResults).toBeAttached();
    await expect(includeBonusMiles).toBeAttached();
    await expect(showDebugButton).toBeAttached();

    // Toggle options and save
    await expandSearchResults.check();
    await includeBonusMiles.check();
    await page.locator('#save').click();

    // Verify status confirmation message appears
    const statusMsg = page.locator('#status');
    await expect(statusMsg).toHaveText('Options saved.', { timeout: 3000 });

    // Save visual artifact
    const screenshotDir = path.resolve(projectRoot, 'artifacts');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    await page.screenshot({
      path: path.join(screenshotDir, 'e2e-options-saved.png'),
    });
  });
});
