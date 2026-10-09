import { chromium, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import { execSync } from 'node:child_process';

const projectRoot = path.resolve(__dirname, '../');
const fixturesDir = path.resolve(projectRoot, 'fixtures');
const imagesDir = path.resolve(projectRoot, 'images');

const searchCall = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'search-graphql-guest.json'), 'utf-8'));
const searchHtml = fs.readFileSync(path.join(fixturesDir, 'search-guest.html'), 'utf-8');
const mapHtml = fs.readFileSync(path.join(fixturesDir, 'search-map-guest.html'), 'utf-8');
const detailsHtml = fs.readFileSync(path.join(fixturesDir, 'details-guest.html'), 'utf-8');
const siteStylesCss = fs.readFileSync(path.join(fixturesDir, 'site-styles.css'), 'utf-8');

function createHttpsServer(): { server: https.Server; port: number } {
  const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-cert-'));
  const keyPath = path.join(certDir, 'key.pem');
  const certPath = path.join(certDir, 'cert.pem');
  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 1 -nodes -subj "/CN=search.aadvantagehotels.com" 2>/dev/null`
  );
  const key = fs.readFileSync(keyPath);
  const cert = fs.readFileSync(certPath);
  fs.rmSync(certDir, { recursive: true, force: true });

  const ORIGIN = 'https://search.aadvantagehotels.com';
  const injectStyles = (html: string) => html.replace('</head>', `<style>${siteStylesCss}</style></head>`);

  const server = https.createServer({ key, cert }, (req, res) => {
    const url = new URL(req.url || '/', ORIGIN);
    if (url.pathname.startsWith('/graphql/search')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(searchCall.response));
      return;
    }
    if (/\/hotel\/[^/]+\.html$/.test(url.pathname)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(injectStyles(detailsHtml));
      return;
    }
    if (url.pathname === '/' || url.pathname.startsWith('/search')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(injectStyles(url.searchParams.get('view') === 'map' ? mapHtml : searchHtml));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  return { server, port: 0 };
}

async function captureScreenshots() {
  console.log('Starting full Chrome Web Store screenshot capture pipeline...');

  const { server } = createHttpsServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  console.log(`Local fixture server listening on https://127.0.0.1:${port}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-ext-'));
  const context = await chromium.launchPersistentContext(tmpDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [
      '--headless=new',
      `--disable-extensions-except=${projectRoot}`,
      `--load-extension=${projectRoot}`,
      `--host-resolver-rules=MAP search.aadvantagehotels.com 127.0.0.1:${port}`,
      '--ignore-certificate-errors',
    ],
  });

  const setupRoutes = async (page: Page) => {
    await page.route('**/*', async (route) => {
      const rUrl = route.request().url();
      const type = route.request().resourceType();
      if (type === 'stylesheet' || type === 'font' || type === 'image') {
        await route.continue();
        return;
      }
      if (
        rUrl.includes('google-analytics') ||
        rUrl.includes('googletagmanager') ||
        rUrl.includes('doubleclick') ||
        rUrl.includes('hotjar') ||
        rUrl.includes('cookielaw')
      ) {
        await route.abort();
        return;
      }
      await route.continue();
    });
  };

  // --------------------------------------------------------------------------
  // SCREEN 1: Search View (1280x800) + Card View
  // --------------------------------------------------------------------------
  console.log('[1/4] Capturing Search View and Hotel Card...');
  const searchPage = await context.newPage();
  await setupRoutes(searchPage);

  await searchPage.goto(
    'https://search.aadvantagehotels.com/search?cid=1951050&city=8683&checkIn=2026-11-12&los=2&rooms=1&adults=2&textToSearch=Dallas+%28TX%29&loyaltySearchType=EARN',
    { waitUntil: 'domcontentloaded' }
  );

  await searchPage.evaluate(async (request) => {
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

  await searchPage.locator('#aa-mpd-search-summary').waitFor({ state: 'visible', timeout: 15000 });
  await searchPage.locator('.aa-mpd-badge').first().waitFor({ state: 'visible', timeout: 10000 });

  await searchPage.addStyleTag({
    url: 'https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&family=Inter:wght@400;500;600;700;800&display=swap',
  });

  await searchPage.addStyleTag({
    content: `
      * {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
      }
      .aa-mpd-chip-indicator,
      .aa-mpd-chip-dollars {
        font-family: "Noto Color Emoji", -apple-system, sans-serif !important;
      }
      [class*="ScreenReaderOnly"], [role="tooltip"], [data-element-name="property-card-private-host"],
      [data-mimir-element-data="accom-js"], [data-testid="primary-promotion-banner-description"] {
        display: none !important;
      }
      .PropertyCardItem {
        list-style: none !important;
        margin: 0 0 16px 0 !important;
        padding: 0 !important;
      }
      .PropertyCard__Container {
        display: flex !important;
        flex-direction: row !important;
        width: 100% !important;
        background: #ffffff !important;
        border: 1px solid #e2e8f0 !important;
        border-radius: 12px !important;
        overflow: hidden !important;
        box-shadow: 0 2px 8px rgba(0,0,0,0.06) !important;
        height: 250px !important;
      }
      .PropertyCard__MosaicContainer {
        width: 270px !important;
        min-width: 270px !important;
        max-width: 270px !important;
        height: 250px !important;
        overflow: hidden !important;
        position: relative !important;
        flex-shrink: 0 !important;
        background: #cbd5e1 !important;
      }
      .PropertyCard__MosaicContainer img:not(:first-of-type) {
        display: none !important;
      }
      .PropertyCard__MosaicContainer img:first-of-type {
        width: 100% !important;
        height: 100% !important;
        object-fit: cover !important;
        display: block !important;
      }
      .PropertyCard__Section--propertyInfo {
        flex: 1 !important;
        padding: 16px 20px !important;
        display: flex !important;
        flex-direction: column !important;
        justify-content: space-between !important;
        min-width: 0 !important;
      }
      .PropertyCard__Section--pricingInfo {
        width: 240px !important;
        min-width: 240px !important;
        padding: 16px 20px !important;
        border-left: 1px solid #f1f5f9 !important;
        background-color: #fafbfc !important;
        display: flex !important;
        flex-direction: column !important;
        justify-content: space-between !important;
        align-items: flex-end !important;
        text-align: right !important;
        flex-shrink: 0 !important;
      }
      [data-element-name="property-info-header"] a,
      [data-element-name="property-info-header"] h2,
      [data-element-name="property-info-header"] h3 {
        font-size: 20px !important;
        font-weight: 700 !important;
        color: #0f172a !important;
        line-height: 1.3 !important;
        text-decoration: none !important;
        margin: 0 0 6px 0 !important;
      }
      [data-element-name="fpc-room-price"] {
        font-size: 24px !important;
        font-weight: 800 !important;
        color: #0f172a !important;
      }
      [data-element-name="fpc-price-text"] {
        font-size: 12px !important;
        color: #64748b !important;
      }
      [data-element-name="sort-bar-container"] {
        display: flex !important;
        flex-direction: row !important;
        align-items: center !important;
        gap: 8px !important;
        margin: 12px 0 16px 0 !important;
        padding: 0 !important;
      }
      [data-element-name="sort-bar-container"] > div:first-child {
        font-size: 14px !important;
        font-weight: 600 !important;
        color: #475569 !important;
        margin-right: 8px !important;
      }
      [data-element-name="sort-bar-container"] [role="group"] {
        display: flex !important;
        flex-direction: row !important;
        align-items: center !important;
        gap: 8px !important;
        flex-wrap: wrap !important;
      }
      [data-element-name="sort-bar-container"] button {
        padding: 8px 14px !important;
        border-radius: 8px !important;
        font-size: 13px !important;
        font-weight: 600 !important;
        border: 1px solid #cbd5e1 !important;
        background: #ffffff !important;
        color: #334155 !important;
        cursor: pointer !important;
      }
      #aa-mpd-sort-button {
        background: #00589c !important;
        color: #ffffff !important;
        border: 1px solid #00589c !important;
        border-radius: 8px !important;
        font-weight: 700 !important;
        box-shadow: 0 2px 6px rgba(0, 88, 156, 0.25) !important;
      }
      #aa-mpd-sort-button .aa-mpd-sort-label {
        color: #ffffff !important;
      }
      .aa-mpd-banner-alert {
        display: none !important;
      }
    `,
  });

  await searchPage.evaluate(() => {
    const fakeHotels = [
      { name: 'The Grand Royal Hotel', address: 'Downtown · Dallas, TX · 0.2 mi from center' },
      { name: 'Classic Luxury Suites', address: 'Arts District · Dallas, TX · 0.4 mi from center' },
      { name: 'The Metropolitan Plaza', address: 'Uptown · Dallas, TX · 0.8 mi from center' },
      { name: 'Royal Park Resort & Spa', address: 'Market Center · Dallas, TX · 1.5 mi from center' },
    ];

    const cards = document.querySelectorAll('li.PropertyCardItem');
    cards.forEach((card, idx) => {
      const fake = fakeHotels[idx % fakeHotels.length];
      const link = card.querySelector('[data-element-name="property-info-header"] a, h2, h3');
      if (link) link.textContent = fake.name;
    });

    // Remove extraneous unstyled login and tab banners
    document.querySelector('[data-testid="primary-promotion-banner-description"]')?.closest('div[class*="Box"]')?.remove();
    document.querySelector('[data-mimir-element-data="accom-js"]')?.remove();
    document.querySelector('[data-element-name="partner-loyalty-tab-switcher"]')?.closest('ul')?.remove();

    // Mark MPD sort as active
    const sortBtn = document.getElementById('aa-mpd-sort-button');
    if (sortBtn) {
      sortBtn.setAttribute('aria-current', 'true');
    }

    const banner = document.getElementById('aa-mpd-search-summary');
    const rightCol = document.querySelector('#searchPageRightColumn');
    const sortBar = document.querySelector('[data-element-name="sort-bar-container"]');

    if (banner && rightCol) {
      banner.style.marginBottom = '12px';
      rightCol.insertAdjacentElement('afterbegin', banner);
    }
    if (sortBar && banner) {
      banner.insertAdjacentElement('afterend', sortBar);
    }
    if (rightCol) {
      rightCol.style.margin = '0 auto';
      rightCol.style.maxWidth = '1040px';
      rightCol.style.width = '100%';
      document.body.replaceChildren(rightCol);
    }
    document.body.style.margin = '0';
    document.body.style.padding = '16px 20px';
    document.body.style.background = '#f8fafc';
  });

  await searchPage.waitForTimeout(1000);
  await searchPage.screenshot({ path: path.join(imagesDir, 'search-screenshot.png') });
  console.log('Saved images/search-screenshot.png (1280x800)');

  // Capture focused card screenshot
  const firstCard = searchPage.locator('li.PropertyCardItem').first();
  await firstCard.screenshot({ path: path.join(imagesDir, 'card-screenshot.png') });
  console.log('Saved images/card-screenshot.png');
  await searchPage.close();

  // --------------------------------------------------------------------------
  // SCREEN 2: Details View (1280x800)
  // --------------------------------------------------------------------------
  console.log('[2/4] Capturing Details View...');
  const detailsPage = await context.newPage();
  await setupRoutes(detailsPage);

  await detailsPage.goto(
    'https://search.aadvantagehotels.com/test-hotel_1/hotel/dallas-tx-us.html?cid=1951050&checkIn=2026-11-12&los=2&rooms=1&adults=2',
    { waitUntil: 'domcontentloaded' }
  );

  await detailsPage.locator('#aa-mpd-details-summary').waitFor({ state: 'visible', timeout: 15000 });
  await detailsPage.locator('.aa-mpd-badge').first().waitFor({ state: 'visible', timeout: 10000 });

  await detailsPage.addStyleTag({
    url: 'https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&family=Inter:wght@400;500;600;700;800&display=swap',
  });

  await detailsPage.addStyleTag({
    content: `
      * {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
      }
      .aa-mpd-badge,
      .aa-mpd-chip,
      .aa-mpd-chip-rate {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
      }
      .aa-mpd-badge-emoji {
        font-family: "Noto Color Emoji", sans-serif !important;
      }
      [class*="ScreenReaderOnly"], [role="tooltip"] {
        display: none !important;
      }
      img[src*="aadvantage.ico"] {
        width: 18px !important;
        height: 18px !important;
        object-fit: contain !important;
        margin-right: 6px !important;
        display: inline-block !important;
      }
      .afcde-flex { display: flex !important; }
      .afcde-flex-row { flex-direction: row !important; }
      .afcde-flex-col { flex-direction: column !important; }
      .afcde-items-center { align-items: center !important; }
      .afcde-items-end { align-items: flex-end !important; }
      .afcde-items-baseline { align-items: baseline !important; }
      .afcde-justify-between { justify-content: space-between !important; }
      .afcde-justify-end { justify-content: flex-end !important; }
      .afcde-w-full { width: 100% !important; }
      .afcde-text-end { text-align: right !important; }
      [data-selenium="master-room"] {
        background: #ffffff !important;
        border: 1px solid #e2e8f0 !important;
        border-radius: 12px !important;
        padding: 24px !important;
        box-shadow: 0 2px 8px rgba(0,0,0,0.06) !important;
      }
      [data-selenium="ChildRoomsList-room"] {
        border-top: 1px solid #e2e8f0 !important;
        padding: 16px 0 !important;
      }
      [data-selenium="ChildRoomsList-room"]:first-child {
        border-top: none !important;
      }
      [data-selenium="ChildRoomsList-room"] .llYXaZ {
        display: flex !important;
        flex-direction: row !important;
        justify-content: space-between !important;
        align-items: center !important;
        width: 100% !important;
      }
      [data-selenium="ChildRoomsList-room"] .llYXaZ > div:first-child {
        display: flex !important;
        flex-direction: row !important;
        justify-content: space-between !important;
        align-items: center !important;
        width: 100% !important;
      }
      [data-selenium="ChildRoomsList-room"] .afcde-w-full:first-child {
        flex: 0 0 280px !important;
        max-width: 280px !important;
      }
      [data-selenium="ChildRoomsList-room"] .afcde-text-end {
        display: flex !important;
        flex-direction: row !important;
        align-items: center !important;
        justify-content: flex-end !important;
        gap: 16px !important;
        flex-shrink: 0 !important;
      }
      .afcde-items-end {
        display: flex !important;
        flex-direction: column !important;
        align-items: flex-end !important;
        gap: 4px !important;
      }
      .afcde-items-end .afcde-flex-nowrap {
        display: inline-flex !important;
        flex-direction: row !important;
        align-items: center !important;
        justify-content: flex-end !important;
        gap: 6px !important;
      }
      .afcde-items-end .afcde-flex-nowrap:empty {
        display: none !important;
      }
      [data-testid="row-item-0"],
      [data-testid="row-item-1"] {
        display: inline-flex !important;
        align-items: center !important;
      }
      [data-selenium="master-room"] .afcde-flex > div:first-child,
      [data-selenium="master-room"] [style*="min-width: 300px"] {
        flex: 0 0 240px !important;
        width: 240px !important;
        min-width: 240px !important;
        max-width: 240px !important;
      }
      [data-selenium="master-room"] .afcde-flex > div:last-child,
      [data-selenium="master-room"] .afcde-ml-16 {
        flex: 1 1 auto !important;
        width: auto !important;
        min-width: 0 !important;
        margin-left: 20px !important;
      }
      .MasterRoom-cartCheckoutBtnsContainer {
        flex-shrink: 0 !important;
        margin-left: 12px !important;
        display: flex !important;
        align-items: center !important;
      }
      [data-selenium="ChildRoomsList-bookButtonInput"] {
        background: #00589c !important;
        color: #ffffff !important;
        border: none !important;
        border-radius: 8px !important;
        padding: 10px 18px !important;
        font-weight: 700 !important;
        font-size: 13px !important;
        cursor: pointer !important;
        white-space: nowrap !important;
      }
      [data-selenium="ChildRoomsList-bookButtonInput"] span {
        color: #ffffff !important;
      }
    `,
  });

  await detailsPage.evaluate(() => {
    const title = document.querySelector('[data-selenium="hotel-header-name"], h1');
    if (title) title.textContent = 'The Grand Royal Hotel';

    // Replace emoji dots with crisp vector SVG circles matching true earn rate tier
    const greenCircle =
      '<svg style="vertical-align:-1px;margin-right:5px;display:inline-block;" width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#16a34a"/></svg>';
    const yellowCircle =
      '<svg style="vertical-align:-1px;margin-right:5px;display:inline-block;" width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#eab308"/></svg>';
    const redCircle =
      '<svg style="vertical-align:-1px;margin-right:5px;display:inline-block;" width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#dc2626"/></svg>';

    document.querySelectorAll('.aa-mpd-badge').forEach((badge) => {
      const rate = parseFloat(badge.getAttribute('data-rate') || '0');
      const circleSvg = rate >= 10 ? greenCircle : (rate < 3 ? redCircle : yellowCircle);
      const rateSpan = badge.querySelector('.aa-mpd-chip-rate');
      if (rateSpan) {
        rateSpan.innerHTML = rateSpan.innerHTML.replace(/^[^\d]*/, circleSvg);
      }
    });

    const banner = document.getElementById('aa-mpd-details-summary');
    const masterRoom = document.querySelector('[data-selenium="master-room"]');

    const header = document.createElement('div');
    header.style.marginBottom = '14px';
    header.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 8px;">
        <div>
          <h1 style="font-size: 26px; font-weight: 800; color: #0d2440; margin: 0 0 4px 0;">The Grand Royal Hotel</h1>
          <p style="color: #64748b; font-size: 14px; margin: 0;">Downtown · Dallas, TX · Earn miles and Loyalty Points on every room</p>
        </div>
        <div style="font-size: 14px; font-weight: 600; color: #00589c; background: #e0f2fe; padding: 6px 14px; border-radius: 20px;">
          4.8 / 5.0 (1,420 reviews)
        </div>
      </div>
    `;

    const container = document.createElement('div');
    container.style.maxWidth = '1140px';
    container.style.margin = '0 auto';
    container.style.width = '100%';

    container.appendChild(header);
    if (banner) {
      banner.style.marginBottom = '16px';
      container.appendChild(banner);
    }
    if (masterRoom) {
      container.appendChild(masterRoom);
    }

    document.body.replaceChildren(container);
    document.body.style.margin = '0';
    document.body.style.padding = '16px 20px';
    document.body.style.background = '#f8fafc';
  });

  await detailsPage.waitForTimeout(1000);
  await detailsPage.screenshot({ path: path.join(imagesDir, 'details-screenshot.png') });
  console.log('Saved images/details-screenshot.png (1280x800)');
  await detailsPage.close();

  // --------------------------------------------------------------------------
  // SCREEN 3: Maps View (1280x800)
  // --------------------------------------------------------------------------
  console.log('[3/4] Capturing Maps View...');
  const mapPage = await context.newPage();
  await setupRoutes(mapPage);

  await mapPage.goto(
    'https://search.aadvantagehotels.com/search?cid=1951050&city=8683&checkIn=2026-11-12&los=2&rooms=1&adults=2&textToSearch=Dallas+%28TX%29&loyaltySearchType=EARN&view=map',
    { waitUntil: 'domcontentloaded' }
  );

  await mapPage.evaluate(async (request) => {
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

  const marker = mapPage.locator('[data-element-name="map-search-property-marker"]').first();
  await marker.waitFor({ state: 'attached', timeout: 15000 });
  await mapPage.waitForTimeout(1000);

  await mapPage.addStyleTag({
    content: `
      .ReactModal__Overlay {
        background: transparent !important;
        position: relative !important;
        inset: auto !important;
        width: 1280px !important;
        height: 800px !important;
      }
      .ReactModal__Content, .maps-container, .maps-container-inner {
        position: relative !important;
        inset: auto !important;
        width: 1280px !important;
        height: 800px !important;
        top: 0 !important;
        left: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        border: none !important;
        border-radius: 0 !important;
        overflow: hidden !important;
      }
      #_GMapContainer_134,
      .leaflet-google-layer,
      .leaflet-container,
      .AgodaMapsContainer {
        width: 1280px !important;
        height: 800px !important;
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        overflow: hidden !important;
        background: #e6ebed !important;
      }
      .leaflet-pane {
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
        width: 100% !important;
        height: 100% !important;
      }
      .leaflet-map-pane {
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
        z-index: 400 !important;
      }
      .leaflet-tile-pane {
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
        width: 1280px !important;
        height: 800px !important;
        z-index: 200 !important;
      }
      .leaflet-marker-pane {
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
        z-index: 600 !important;
      }
      .leaflet-marker-icon {
        position: absolute !important;
        z-index: 600 !important;
      }
      .propertyMarkerIcon-content {
        padding: 4px 8px !important;
        border-radius: 16px !important;
        font-size: 12px !important;
        font-weight: 700 !important;
        border: 2px solid #ffffff !important;
        box-shadow: 0 3px 8px rgba(0,0,0,0.3) !important;
        display: inline-flex !important;
        align-items: center !important;
        gap: 4px !important;
        color: #ffffff !important;
        cursor: pointer !important;
        white-space: nowrap !important;
        transition: transform 0.15s ease !important;
      }
      .propertyMarkerIcon-content:hover {
        transform: scale(1.1) !important;
        z-index: 9999 !important;
      }
      .exceptional-price-pin, .favorite-icon-pin, .landmarkMarkerIcon {
        display: none !important;
      }
      #aa-mpd-search-summary {
        position: absolute !important;
        top: 20px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        z-index: 10000 !important;
        box-shadow: 0 4px 16px rgba(13, 36, 64, 0.15) !important;
        max-width: 680px !important;
        width: 90% !important;
        margin: 0 !important;
      }
      .aa-mpd-banner-alert {
        display: none !important;
      }
    `,
  });

  await mapPage.evaluate(() => {
    // Populate seamless ESRI World Street Map tiles of Dallas (6 columns x 4 rows)
    const tilePane = document.querySelector('.leaflet-tile-pane');
    if (tilePane) {
      tilePane.innerHTML = '';
      const startX = 944;
      const startY = 1651;
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 6; c++) {
          const img = document.createElement('img');
          img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/12/${startY + r}/${startX + c}`;
          img.style.position = 'absolute';
          img.style.left = `${c * 256 - 120}px`;
          img.style.top = `${r * 256 - 150}px`;
          img.style.width = '256px';
          img.style.height = '256px';
          img.style.display = 'block';
          tilePane.appendChild(img);
        }
      }
    }

    const banner = document.getElementById('aa-mpd-search-summary');
    const modalContent = document.querySelector('.ReactModal__Content') || document.querySelector('.maps-container-inner');
    if (banner && modalContent) {
      modalContent.appendChild(banner);
    }
    const target = document.querySelector('.ReactModal__Overlay') || modalContent;
    if (target) {
      document.body.replaceChildren(target);
    }
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.overflow = 'hidden';
  });

  await mapPage
    .waitForFunction(
      () => {
        const imgs = Array.from(document.querySelectorAll('.leaflet-tile-pane img')) as HTMLImageElement[];
        return imgs.length > 0 && imgs.every((img) => img.complete && img.naturalWidth > 0);
      },
      undefined,
      { timeout: 15000 }
    )
    .catch(() => console.log('Tile images timed out waiting'));

  await mapPage.waitForTimeout(500);
  await mapPage.screenshot({ path: path.join(imagesDir, 'maps-screenshot.png') });
  console.log('Saved images/maps-screenshot.png (1280x800)');
  await mapPage.close();

  // --------------------------------------------------------------------------
  // SCREEN 4: Options Dashboard View (1280x800)
  // --------------------------------------------------------------------------
  console.log('[4/4] Capturing Options Dashboard View...');
  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker');

  const extensionId = background.url().split('/')[2];
  const optionsPage = await context.newPage();
  await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);

  // Seed sample hotel batches to IndexedDB
  await optionsPage.evaluate(async () => {
    const loc1 = 'Dallas, TX, USA';
    const batches = [
      {
        criteria: {
          location: loc1,
          checkIn: '2026-11-12',
          checkOut: '2026-11-14',
          nights: 2,
          rooms: 1,
          guests: 2,
          timestamp: '2026-10-09T10:00:00.000Z',
          url: 'mock',
        },
        rates: [
          {
            hotelName: 'The Grand Royal Hotel',
            location: loc1,
            neighborhood: 'Downtown',
            country: 'United States',
            price: 536,
            basePrice: 460,
            allInPrice: 536,
            miles: 13400,
            mpd: 25.0,
            isTotalPrice: true,
            isBonus: false,
            stars: 5,
            rating: 9.5,
            reviewCount: 1420,
            refundable: true,
            chain: 'Marriott',
            imageUrl: 'https://pix8.agoda.net/hotelImages/2461695/0/e90506a04b7c645d50edac45ea232e63.jpeg?va=1',
          },
          {
            hotelName: 'Classic Luxury Suites',
            location: loc1,
            neighborhood: 'Uptown',
            country: 'United States',
            price: 680,
            basePrice: 580,
            allInPrice: 680,
            miles: 15640,
            mpd: 23.0,
            isTotalPrice: true,
            isBonus: false,
            stars: 5,
            rating: 9.3,
            reviewCount: 1180,
            refundable: true,
            chain: 'Hilton',
            imageUrl: 'https://pix8.agoda.net/hotelImages/7453561/0/b193475649e9d908d125bab30c23a7cb.jpg?va=1',
          },
          {
            hotelName: 'The Metropolitan Plaza',
            location: loc1,
            neighborhood: 'Arts District',
            country: 'United States',
            price: 420,
            basePrice: 360,
            allInPrice: 420,
            miles: 8400,
            mpd: 20.0,
            isTotalPrice: true,
            isBonus: false,
            stars: 4.5,
            rating: 9.1,
            reviewCount: 890,
            refundable: true,
            chain: 'Hyatt',
            imageUrl: 'https://pix8.agoda.net/hotelImages/7453561/0/5131dd283e0c5a41c4e0da86872f9360.jpg?va=1',
          },
        ],
      },
    ];

    for (const b of batches) {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'RECORD_RATES', criteria: b.criteria, rates: b.rates }, () => resolve(true));
      });
    }
  });

  await optionsPage.waitForTimeout(500);
  await optionsPage.reload();
  await optionsPage.locator('#top3VisualContainer').waitFor({ state: 'visible', timeout: 8000 });
  await optionsPage.locator('#topMpdsTable tbody tr').first().waitFor({ state: 'visible', timeout: 8000 });

  await optionsPage.addStyleTag({
    url: 'https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&family=Inter:wght@400;500;600;700;800&display=swap',
  });
  await optionsPage.addStyleTag({
    content: `
      * {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, "Noto Color Emoji", sans-serif !important;
      }
    `,
  });

  // Clean vector SVG icons for tabs and headers
  await optionsPage.evaluate(() => {
    const dashTab = document.querySelector('[data-tab="dashboard-tab"]');
    if (dashTab) {
      dashTab.innerHTML =
        '<svg style="vertical-align:-2px;margin-right:6px;" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>Dashboard';
    }
    const histTab = document.querySelector('[data-tab="history-tab"]');
    if (histTab) {
      histTab.innerHTML =
        '<svg style="vertical-align:-2px;margin-right:6px;" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>Query History & Export';
    }
    const setTab = document.querySelector('[data-tab="settings-tab"]');
    if (setTab) {
      setTab.innerHTML =
        '<svg style="vertical-align:-2px;margin-right:6px;" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>Settings';
    }

    const top3Header = document.querySelector('#top3VisualContainer > div:first-child');
    if (top3Header) {
      const starSvg =
        '<svg style="vertical-align:-3px;margin-right:6px;display:inline-block;" width="18" height="18" viewBox="0 0 24 24" fill="#f59e0b"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
      top3Header.innerHTML = `${starSvg}Top 3 Earning Properties`;
    }
    const cardTitle = document.querySelector('.card-title');
    if (cardTitle && cardTitle.textContent?.includes('Top MPD Deals')) {
      const trophySvg =
        '<svg style="vertical-align:-3px;margin-right:6px;display:inline-block;" width="18" height="18" viewBox="0 0 24 24" fill="#f59e0b"><path d="M6 9H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2M18 9h2a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2M4 5h16a2 2 0 0 1 2 2v2a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6V7a2 2 0 0 1 2-2zM9 19h6M12 15v4"/></svg>';
      cardTitle.innerHTML = `${trophySvg}Top MPD Deals & Sweet Spot Finder`;
    }

    // Clean location pin bullets on cards
    document.querySelectorAll('.property-card-location').forEach((loc) => {
      const pinSvg =
        '<svg style="vertical-align:-2px;margin-right:4px;display:inline-block;" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2.2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
      loc.innerHTML = loc.innerHTML.replace(/📍\s*/, pinSvg);
    });

    // Replace target/score badge emoji with clean SVG
    document.querySelectorAll('.score-badge').forEach((badge) => {
      const targetSvg =
        '<svg style="vertical-align:-2px;margin-right:4px;display:inline-block;" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2.4"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>';
      badge.innerHTML = badge.innerHTML.replace(/🎯\s*/, targetSvg);
    });

    // Replace calendar emoji in Quoted Stay
    document.querySelectorAll('.property-card-stay-info span').forEach((span) => {
      const calSvg =
        '<svg style="vertical-align:-2px;margin-right:4px;display:inline-block;" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2.2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
      span.innerHTML = span.innerHTML.replace(/📅\s*/, calSvg);
    });

    // Replace house emoji in neighborhood
    document.querySelectorAll('[title="Quoted Neighborhood"]').forEach((span) => {
      const houseSvg =
        '<svg style="vertical-align:-2px;margin-right:3px;display:inline-block;" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';
      span.innerHTML = span.innerHTML.replace(/🏡\s*/, houseSvg);
    });
  });

  await optionsPage.waitForTimeout(800);
  await optionsPage.screenshot({ path: path.join(imagesDir, 'options-dashboard-screenshot.png') });
  console.log('Saved images/options-dashboard-screenshot.png (1280x800)');
  await optionsPage.close();

  await context.close();
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('All 5 extension screenshots captured successfully!');

  // Re-generate promo tiles using the updated screenshots
  console.log('Re-generating promo tiles (promo-small.png, promo-marquee.png)...');
  execSync('npx tsx scripts/capture-promo-tiles.ts', { cwd: projectRoot, stdio: 'inherit' });
  console.log('Screenshot capture and promo tile generation complete!');
}

captureScreenshots().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
