import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import { execSync } from 'node:child_process';

// Runs the built extension against real captures of the redesigned search.aadvantagehotels.com
// (Agoda white label), served over HTTPS on the real hostname. Regenerate the fixtures with
// `node scripts/fetch-guest-fixtures.mjs`.

const projectRoot = path.resolve(__dirname, '../../');
const fixturesDir = path.resolve(projectRoot, 'fixtures');
const screenshotDir = path.resolve(projectRoot, 'artifacts');

const searchCall = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'search-graphql-guest.json'), 'utf-8'));
const pricedPropertyIds: string[] = searchCall.response.data.citySearch.properties
  .filter((p: any) => p.pricing?.offers?.[0]?.roomOffers?.[0]?.room?.pricing?.[0]?.price?.perBook)
  .map((p: any) => String(p.propertyId));

const ORIGIN = 'https://search.aadvantagehotels.com';
const SEARCH_URL = `${ORIGIN}/search?cid=1951050&city=8683&checkIn=2026-11-12&los=2&rooms=1&adults=2&textToSearch=Dallas+%28TX%29&loyaltySearchType=EARN`;
const MAP_URL = `${SEARCH_URL}&view=map`;
const DETAILS_URL = `${ORIGIN}/test-hotel_1/hotel/dallas-tx-us.html?cid=1951050&checkIn=2026-11-12&los=2&rooms=1&adults=2`;

interface TestFixtures {
  context: BrowserContext;
  serverUrl: string;
  extensionId: string;
}

export const test = base.extend<TestFixtures>({
  serverUrl: async ({}, use) => {
    const searchHtml = fs.readFileSync(path.join(fixturesDir, 'search-guest.html'), 'utf-8');
    const mapHtml = fs.readFileSync(path.join(fixturesDir, 'search-map-guest.html'), 'utf-8');
    const detailsHtml = fs.readFileSync(path.join(fixturesDir, 'details-guest.html'), 'utf-8');

    // Generate ephemeral self-signed cert for search.aadvantagehotels.com
    const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-cert-'));
    const keyPath = path.join(certDir, 'key.pem');
    const certPath = path.join(certDir, 'cert.pem');
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 1 -nodes -subj '/CN=search.aadvantagehotels.com' 2>/dev/null`
    );
    const key = fs.readFileSync(keyPath);
    const cert = fs.readFileSync(certPath);
    fs.rmSync(certDir, { recursive: true, force: true });

    const sendHtml = (res: any, html: string) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    };

    const server = https.createServer({ key, cert }, (req, res) => {
      const url = new URL(req.url || '/', ORIGIN);
      if (url.pathname.startsWith('/graphql/search')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(searchCall.response));
        return;
      }
      if (/\/(checkout|payment|book)/.test(url.pathname)) {
        sendHtml(
          res,
          '<!DOCTYPE html><html><head><title>Checkout</title></head><body><h1>Payment and Checkout</h1><form id="cc-form"><input type="text" name="cardNumber" /></form></body></html>'
        );
        return;
      }
      if (/\/hotel\/[^/]+\.html$/.test(url.pathname)) {
        sendHtml(res, detailsHtml);
        return;
      }
      if (url.pathname === '/' || url.pathname.startsWith('/search')) {
        sendHtml(res, url.searchParams.get('view') === 'map' ? mapHtml : searchHtml);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as any).port;

    await use(`https://127.0.0.1:${port}`);

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
        `--host-resolver-rules=MAP search.aadvantagehotels.com 127.0.0.1:${port}`,
        '--ignore-certificate-errors',
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

// Fixtures have their scripts stripped; block any remaining third-party requests
async function openPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).hostname === 'search.aadvantagehotels.com') {
      await route.continue();
    } else {
      await route.abort();
    }
  });
  return page;
}

// Replays the site's results request the way the live page makes it: through a page-level
// wrapper assigned over window.fetch, with an AbortSignal that is aborted after the body is read.
async function replaySearchRequest(page: Page) {
  await page.evaluate(async (request) => {
    const original = window.fetch;
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      return original.call(this, input, init);
    };
    const controller = new AbortController();
    const response = await window.fetch('/graphql/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    await response.json();
    controller.abort();
  }, searchCall.request);
}

// Counts "Earn N miles" captions on cards/rooms that show a price
async function countMilesCaptions(page: Page, itemSelector: string): Promise<number> {
  return page.evaluate(
    (selector) =>
      Array.from(document.querySelectorAll(selector))
        .filter((item) => item.querySelector('[data-element-name="fpc-room-price"]'))
        .flatMap((item) => Array.from(item.querySelectorAll('[data-testid="upc_caption"]')))
        .filter((el) => /Earn [\d,]+ miles/.test(el.childNodes[0]?.textContent || el.textContent || '')).length,
    itemSelector
  );
}

function ensureScreenshotDir() {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

test.describe('AA Hotels MPD Extension E2E Suite (search.aadvantagehotels.com)', () => {
  test('1. Search results: badges every miles tier, shows the banner, and never paginates', async ({ context }) => {
    const page = await openPage(context);
    // Record clicks on pagination and image carousel controls before the extension loads
    await page.addInitScript(() => {
      (window as any).__forbiddenClicks = 0;
      document.addEventListener(
        'click',
        (e) => {
          const target = e.target as Element;
          if (target.closest?.('[data-selenium="pagination-panel"], [data-element-name="property-card-gallery"]')) {
            (window as any).__forbiddenClicks++;
          }
        },
        true
      );
    });

    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded' });

    const summaryBanner = page.locator('#aa-mpd-search-summary');
    await expect(summaryBanner).toBeVisible({ timeout: 10000 });
    await expect(summaryBanner).toContainText(/Best earn rate on this page: \d+\.\d miles\/\$/);

    const expectedBadges = await countMilesCaptions(page, 'li.PropertyCardItem');
    expect(expectedBadges).toBeGreaterThan(0);
    await expect(page.locator('.aa-mpd-badge')).toHaveCount(expectedBadges);

    // Badge = miles / total price for the first priced card
    const first = await page.evaluate(() => {
      const card = Array.from(document.querySelectorAll('li.PropertyCardItem')).find((c) =>
        c.querySelector('[data-element-name="fpc-room-price"]')
      )!;
      const price = Number(card.querySelector('[data-element-name="fpc-room-price"]')!.getAttribute('data-fpc-value'));
      const caption = card.querySelector('.aa-mpd-badge')!.parentElement!;
      const miles = Number(caption.childNodes[0].textContent!.match(/[\d,]+/)![0].replace(/,/g, ''));
      return { price, miles, badge: caption.querySelector('.aa-mpd-badge')!.textContent };
    });
    expect(first.badge).toBe(` (${(first.miles / first.price).toFixed(1)} miles/$)`);

    // Auto-expansion is on by default; it must not page through results
    await page.waitForTimeout(2500);
    expect(await page.evaluate(() => (window as any).__forbiddenClicks)).toBe(0);
    await expect(page.locator('[data-selenium="pagination-panel"]')).toContainText('Page 1 of');

    // Fixture export panel is opt-in
    await expect(page.locator('#aa-mpd-debug-panel')).toHaveCount(0);

    ensureScreenshotDir();
    await page.screenshot({ path: path.join(screenshotDir, 'e2e-search-results.png') });
    const firstCard = page.locator('li.PropertyCardItem:has(.aa-mpd-badge)').first();
    await firstCard.scrollIntoViewIfNeeded();
    await firstCard.screenshot({ path: path.join(screenshotDir, 'e2e-hotel-card-badges.png') });
  });

  test('2. Network interception: reads the results API through page fetch wrappers and aborted requests', async ({
    context,
  }) => {
    const page = await openPage(context);
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#aa-mpd-search-summary')).toBeVisible({ timeout: 10000 });

    await replaySearchRequest(page);

    await expect
      .poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('aa_hotels_latest_rates') || '[]').length))
      .toBe(pricedPropertyIds.length);
    const cached = await page.evaluate(() => JSON.parse(sessionStorage.getItem('aa_hotels_latest_rates') || '[]'));
    expect(cached.map((r: any) => r.hotelId).sort()).toEqual([...pricedPropertyIds].sort());
    expect(cached[0]).toMatchObject({ checkInDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), nights: 2 });
  });

  test('3. Map view: recolors Agoda property markers from intercepted rates', async ({ context }) => {
    const page = await openPage(context);
    await page.goto(MAP_URL, { waitUntil: 'domcontentloaded' });
    const markers = page.locator('[data-element-name="map-search-property-marker"]');
    await expect(markers.first()).toBeAttached({ timeout: 10000 });

    await replaySearchRequest(page);

    const markerIdsInPayload = await page.evaluate(
      (ids) =>
        Array.from(document.querySelectorAll('[data-element-name="map-search-property-marker"]'))
          .map((m) => m.getAttribute('data-id')!)
          .filter((id) => ids.includes(id)),
      pricedPropertyIds
    );
    expect(markerIdsInPayload.length).toBeGreaterThan(0);
    for (const id of markerIdsInPayload) {
      await expect(page.locator(`[data-element-name="map-search-property-marker"][data-id="${id}"]`)).toHaveAttribute(
        'data-aa-mpd',
        /^\d+\.\d$/,
        { timeout: 5000 }
      );
    }

    // The best marker is forest green, with the rate in its tooltip (data-aa-mpd is rounded, so
    // several markers can share the top value)
    const top = await page.evaluate(() => {
      const colored = Array.from(document.querySelectorAll<HTMLElement>('[data-element-name="map-search-property-marker"][data-aa-mpd]'));
      const max = Math.max(...colored.map((m) => Number(m.dataset.aaMpd)));
      return colored
        .filter((m) => Number(m.dataset.aaMpd) === max)
        .map((m) => ({
          color: m.querySelector<HTMLElement>('.propertyMarkerIcon-content')!.style.backgroundColor,
          title: m.title,
          mpd: m.dataset.aaMpd,
        }));
    });
    expect(top.map((m) => m.color)).toContain('rgb(21, 128, 61)');
    expect(top[0].title).toContain(`${top[0].mpd} miles/$`);

    ensureScreenshotDir();
    await page.screenshot({ path: path.join(screenshotDir, 'e2e-map-view.png') });
  });

  test('4. Hotel page (/<slug>/hotel/<city>.html): banner above the room grid and badges on every room', async ({
    context,
  }) => {
    const page = await openPage(context);
    await page.goto(DETAILS_URL, { waitUntil: 'domcontentloaded' });

    const detailsSummary = page.locator('#aa-mpd-details-summary');
    await expect(detailsSummary).toBeVisible({ timeout: 10000 });
    await expect(detailsSummary).toContainText(/Best earn rate on this page: \d+\.\d miles\/\$/);
    expect(await detailsSummary.evaluate((el) => el.nextElementSibling?.id)).toBe('property-room-grid-root');

    const expectedBadges = await countMilesCaptions(page, '[data-selenium="ChildRoomsList-room"]');
    expect(expectedBadges).toBeGreaterThan(0);
    await expect(page.locator('.aa-mpd-badge')).toHaveCount(expectedBadges);
    expect(
      await page.evaluate(
        () => Array.from(document.querySelectorAll('[data-selenium="ChildRoomsList-room"]')).filter((r) => !r.querySelector('.aa-mpd-badge')).length
      )
    ).toBe(0);

    ensureScreenshotDir();
    await detailsSummary.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(screenshotDir, 'e2e-property-details.png') });
    await page.locator('[data-selenium="ChildRoomsList-room"]').first().screenshot({
      path: path.join(screenshotDir, 'e2e-room-rates-badges.png'),
    });
  });

  test('5. Search auto-expansion: clicks a real "Load more" button and badges the new cards', async ({ context }) => {
    const page = await openPage(context);
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.aa-mpd-badge').first()).toBeVisible({ timeout: 10000 });
    const initialCount = await page.locator('.aa-mpd-badge').count();

    // Appends a copy of a priced card (as a new hotel) when clicked, then disappears
    const tiersPerCard = await page.evaluate(() => {
      const template = Array.from(document.querySelectorAll('li.PropertyCardItem')).find((c) =>
        c.querySelector('[data-element-name="fpc-room-price"]')
      )!;
      const button = document.createElement('button');
      button.textContent = 'Load more';
      button.addEventListener('click', () => {
        const clone = template.cloneNode(true) as Element;
        clone.querySelectorAll('.aa-mpd-badge').forEach((b) => b.remove());
        clone.setAttribute('data-hotelid', '999999001');
        template.parentElement!.appendChild(clone);
        (window as any).__loadMoreClicks = ((window as any).__loadMoreClicks || 0) + 1;
        button.remove();
      });
      template.parentElement!.after(button);
      return template.querySelectorAll('.aa-mpd-badge').length;
    });

    await expect(page.locator('.aa-mpd-badge')).toHaveCount(initialCount + tiersPerCard, { timeout: 10000 });
    expect(await page.evaluate(() => (window as any).__loadMoreClicks)).toBe(1);
  });

  test('6. Extension options page (options.html): persists configuration changes to chrome.storage.sync', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 850 });

    // Navigate to options page and populate sample data in IndexedDB
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        const req = indexedDB.open("AAHotelsMPD", 1);
        req.onupgradeneeded = (e: any) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains("top_mpds")) {
            const topStore = db.createObjectStore("top_mpds", { keyPath: "id" });
            topStore.createIndex("mpd", "mpd", { unique: false });
            topStore.createIndex("timestamp", "timestamp", { unique: false });
          }
          if (!db.objectStoreNames.contains("location_stats")) {
            const locStore = db.createObjectStore("location_stats", { keyPath: "location" });
            locStore.createIndex("topMpd", "topMpd", { unique: false });
          }
        };
        req.onsuccess = (e: any) => {
          const db = e.target.result;
          const tx = db.transaction(["top_mpds", "location_stats"], "readwrite");
          const topStore = tx.objectStore("top_mpds");
          topStore.put({
            id: "2687",
            hotelId: "2687",
            hotelName: "Hilton Anatole, Dallas",
            location: "Dallas, TX, USA",
            neighborhood: "Stemmons Corridor",
            mpd: 22.4,
            price: 557,
            allInPrice: 557,
            miles: 12500,
            nights: 2,
            rooms: 1,
            guests: 2,
            stars: 4,
            rating: 8.7,
            reviewCount: 488,
            checkIn: "2026-10-05",
            checkOut: "2026-10-07",
            timestamp: new Date().toISOString(),
            chain: "Hilton",
            refundable: true,
            imageUrl: "https://pix8.agoda.net/hotelImages/79546/0/015c1d847120bc9a6a42e944add42489.jpg?ca=7&ce=1&s=480x480",
          });
          topStore.put({
            id: "15311513",
            hotelId: "15311513",
            hotelName: "SOVA Micro-Room & Social Hotel",
            location: "Dallas, TX, USA",
            neighborhood: "Dallas City Center",
            mpd: 20.0,
            price: 216,
            allInPrice: 216,
            miles: 4320,
            nights: 2,
            rooms: 1,
            guests: 2,
            stars: 3,
            rating: 8.4,
            reviewCount: 1072,
            checkIn: "2026-10-05",
            checkOut: "2026-10-07",
            timestamp: new Date().toISOString(),
            chain: "Independent / Other",
            refundable: true,
            imageUrl: "https://pix8.agoda.net/hotelImages/2411229/0/07e8e05bb036533cb447115ac1068eae.jpeg?s=480x480",
          });
          topStore.put({
            id: "4412",
            hotelId: "4412",
            hotelName: "Omni Dallas Hotel",
            location: "Dallas, TX, USA",
            neighborhood: "Dallas City Center",
            mpd: 12.5,
            price: 665,
            allInPrice: 665,
            miles: 8300,
            nights: 2,
            rooms: 1,
            guests: 2,
            stars: 4,
            rating: 9.0,
            reviewCount: 856,
            checkIn: "2026-10-05",
            checkOut: "2026-10-07",
            timestamp: new Date().toISOString(),
            chain: "Omni",
            refundable: false,
            imageUrl: "https://pix8.agoda.net/hotelImages/2287675/1313844665/d7323fa3b7b41dfe92d3c96a5a48c09f.jpeg?ce=3&s=480x480",
          });
          const locStore = tx.objectStore("location_stats");
          locStore.put({
            location: "Dallas, TX, USA",
            country: "USA",
            state: "TX",
            city: "Dallas",
            count: 3,
            topMpd: 22.4,
            avgMpd: 18.3,
            minMpd: 12.5,
            topHotelName: "Hilton Anatole, Dallas",
            topHotelId: "2687",
            lastUpdated: new Date().toISOString(),
          });
          tx.oncomplete = () => resolve(true);
        };
      });
    });

    // Reload page to display populated dashboard
    await page.reload();
    await page.waitForTimeout(400);

    await expect(page).toHaveTitle('AA Hotels MPD - Dashboard & Settings');

    ensureScreenshotDir();

    // Capture Dashboard tab screenshot
    await page.screenshot({
      path: path.join(screenshotDir, 'e2e-options-dashboard.png'),
    });

    // Switch to settings tab
    await page.locator('button[data-tab="settings-tab"]').click();

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

    // Fixture export panel is opt-in
    await expect(showDebugButton).not.toBeChecked();

    // Toggle options and save
    await expandSearchResults.check();
    await includeBonusMiles.check();
    await page.locator('#save').click();

    // Verify status confirmation message appears
    const statusMsg = page.locator('#status');
    await expect(statusMsg).toHaveText('Settings saved.', { timeout: 3000 });
    const stored = await context.serviceWorkers()[0].evaluate(() => chrome.storage.sync.get(null));
    expect(stored).toMatchObject({ expandSearchResults: true, includeBonusMiles: true, showDebugButton: false });

    // Save visual artifact of settings tab
    await page.screenshot({
      path: path.join(screenshotDir, 'e2e-options-settings.png'),
    });
    fs.copyFileSync(
      path.join(screenshotDir, 'e2e-options-settings.png'),
      path.join(screenshotDir, 'e2e-options-saved.png')
    );
  });

  test('7. Fixture export panel appears only after enabling it in settings', async ({ context, extensionId }) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.locator('button[data-tab="settings-tab"]').click();
    await options.locator('#showDebugButton').check();
    await options.locator('#save').click();
    await expect(options.locator('#status')).toHaveText('Settings saved.', { timeout: 3000 });

    const page = await openPage(context);
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#aa-mpd-debug-panel')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#aa-mpd-debug-panel')).toContainText('DOM Fixture');
  });

  test('8. Sensitive checkout page exclusion guard: never injects scripts or badges on checkout URLs', async ({
    context,
  }) => {
    const page = await openPage(context);

    await page.goto('https://search.aadvantagehotels.com/checkout/step1', {
      waitUntil: 'domcontentloaded',
    });

    // Wait 1 second to confirm no deferred scripts or observers attach
    await page.waitForTimeout(1000);

    // Verify absolutely no MPD elements exist on the page
    expect(await page.locator('#aa-mpd-search-summary').count()).toBe(0);
    expect(await page.locator('#aa-mpd-details-summary').count()).toBe(0);
    expect(await page.locator('.aa-mpd-badge').count()).toBe(0);
    expect(await page.locator('#aa-mpd-debug-panel').count()).toBe(0);
  });
});
