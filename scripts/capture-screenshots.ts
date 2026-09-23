import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';

const projectRoot = path.resolve(__dirname, '../');
const fixturesDir = path.resolve(projectRoot, 'fixtures');
const imagesDir = path.resolve(projectRoot, 'images');

async function setupPageRoutes(page: any) {
  await page.route('**/*', async (route: any) => {
    const url = route.request().url();
    const resourceType = route.request().resourceType();

    if (resourceType === 'stylesheet' || resourceType === 'font' || url.includes('.css')) {
      await route.continue();
      return;
    }
    if (resourceType === 'image') {
      await route.continue();
      return;
    }
    if (
      url.includes('cloudfront.net') ||
      url.includes('googletagmanager') ||
      url.includes('hotjar') ||
      url.includes('cookielaw') ||
      url.includes('doubleclick') ||
      url.includes('google-analytics') ||
      url.includes('maps.googleapis.com') ||
      (resourceType === 'script' && !url.includes('127.0.0.1') && !url.includes('chrome-extension'))
    ) {
      await route.abort();
      return;
    }
    await route.continue();
  });
}

async function captureScreenshots() {
  console.log('Starting screenshot capture...');

  const searchHtml = fs.readFileSync(path.join(fixturesDir, 'search-authenticated.html'), 'utf-8');
  const mapHtml = fs.readFileSync(path.join(fixturesDir, 'search-map-authenticated.html'), 'utf-8');
  const detailsHtml = fs.readFileSync(path.join(fixturesDir, 'details-authenticated.html'), 'utf-8');

  const pinMatches = Array.from(mapHtml.matchAll(/data-testid="hotel-pin-(\d+)"[^>]*><span>\$?([\d,]+)/g));
  const allMapResults = pinMatches.map(([_, id, priceStr], index) => {
    const price = parseInt(priceStr.replace(/,/g, ''), 10) || 1000;
    if (id === '12498') return { hotel: { id: '12498' }, economics: { total: { amount: 1702 }, rewardAmount: 17020, rewardAmountTiered: 17020 } };
    if (id === '465') return { hotel: { id: '465' }, economics: { total: { amount: 5081 }, rewardAmount: 15243, rewardAmountTiered: 15243 } };
    if (id === '20286') return { hotel: { id: '20286' }, economics: { total: { amount: 1605 }, rewardAmount: 8025, rewardAmountTiered: 11235 } };
    const mpd = 3.8 + ((index % 17) / 16) * 5.4;
    const reward = Math.round(price * mpd);
    return { hotel: { id }, economics: { total: { amount: price }, rewardAmount: reward, rewardAmountTiered: reward } };
  });

  const server = http.createServer((req, res) => {
    const url = req.url || '';
    if (url.includes('/rest/aadvantage-hotels') || url.includes('/search/results')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ searchResult: { results: allMapResults } }));
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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-ext-'));
  const context = await chromium.launchPersistentContext(tmpDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [
      '--headless=new',
      `--disable-extensions-except=${projectRoot}`,
      `--load-extension=${projectRoot}`,
      `--host-resolver-rules=MAP www.aadvantagehotels.com 127.0.0.1:${port}`,
    ],
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 5000 });
  }
  const extensionId = new URL(worker.url()).hostname;

  // Anonymization script string for search and details
  const anonymizeSearchAndDetailsStr = `
    (() => {
      const words = ['Lorem', 'Ipsum', 'Dolor', 'Sit', 'Amet', 'Consectetur', 'Adipiscing', 'Elit'];
      const prefixes = ['The', 'Grand', 'Royal', 'Luxury', 'Classic'];
      const suffixes = ['Hotel', 'Resort', 'Suites', 'Inn', 'Plaza'];
      const getRandomHotelName = () => {
        const p = prefixes[Math.floor(Math.random() * prefixes.length)];
        const w = words[Math.floor(Math.random() * words.length)];
        const s = suffixes[Math.floor(Math.random() * suffixes.length)];
        return p + ' ' + w + ' ' + s;
      };
      
      const cities = ['Metropolis', 'Riverdale', 'Springfield', 'Gotham', 'Star City'];
      const states = ['NY', 'CA', 'TX', 'FL', 'IL'];
      const getRandomLocation = () => {
        const c = cities[Math.floor(Math.random() * cities.length)];
        const s = states[Math.floor(Math.random() * states.length)];
        return c + ', ' + s;
      };

      const hotelCache = new Map();

      // Hotel cards on search page
      document.querySelectorAll('[data-testid^="hotel-card-"]').forEach(card => {
        const nameEl = card.querySelector('[data-testid="hotel-name"]') || card.querySelector('h3');
        if (nameEl) {
          const originalName = nameEl.textContent || '';
          if (!hotelCache.has(originalName)) {
            hotelCache.set(originalName, {
              name: getRandomHotelName(),
              location: getRandomLocation(),
              neighborhood: words[Math.floor(Math.random() * words.length)] + ' District'
            });
          }
          const info = hotelCache.get(originalName);
          nameEl.textContent = info.name;

          const neighEl = card.querySelector('[data-testid="hotel-neighborhood"]');
          if (neighEl) neighEl.textContent = info.neighborhood;

          const locEl = card.querySelector('[data-testid="hotel-location"]');
          if (locEl) locEl.textContent = info.location;
        }
      });

      // Map cards
      document.querySelectorAll('[data-testid="map-hotel-card"]').forEach(card => {
        const nameEl = card.querySelector('h3');
        if (nameEl) {
          const originalName = nameEl.textContent || '';
          if (!hotelCache.has(originalName)) {
            hotelCache.set(originalName, {
              name: getRandomHotelName(),
              location: getRandomLocation(),
              neighborhood: words[Math.floor(Math.random() * words.length)] + ' District'
            });
          }
          const info = hotelCache.get(originalName);
          nameEl.textContent = info.name;
        }
      });

      // Hotel details header
      const detailHeader = document.querySelector('[data-testid="hotel-name-header"]');
      if (detailHeader) {
        detailHeader.textContent = getRandomHotelName();
      }

      // Room names
      document.querySelectorAll('[data-testid="room-group-header"] p:first-child').forEach(p => {
        p.textContent = getRandomHotelName() + ' - ' + p.textContent;
      });
    })();
  `;

  // ==========================================
  // 1. Search Screenshot (hotel-results-list-container)
  // ==========================================
  console.log('1/4 Capturing Search screen...');
  const searchPage = await context.newPage();
  await setupPageRoutes(searchPage);
  await searchPage.goto(
    `http://www.aadvantagehotels.com/search?adults=2&checkIn=10%2F04%2F2026&checkOut=10%2F10%2F2026&currency=USD`,
    { waitUntil: 'domcontentloaded' }
  );
  const searchBanner = searchPage.locator('#aa-mpd-search-summary');
  await searchBanner.waitFor({ state: 'visible', timeout: 10000 });
  await searchPage.locator('.aa-mpd-badge').first().waitFor({ state: 'visible', timeout: 5000 });

  // Anonymize in DOM
  await searchPage.evaluate(anonymizeSearchAndDetailsStr);

  // Isolate container and render at top
  await searchPage.evaluate(`
    (() => {
      const banner = document.getElementById('aa-mpd-search-summary');
      const container = document.querySelector('[data-testid="hotel-results-list-container"]');
      if (banner && container) {
        banner.style.marginBottom = '24px';
        container.insertAdjacentElement('afterbegin', banner);
      }
      if (container) {
        container.style.margin = '20px auto';
        container.style.maxWidth = '1000px';
        document.body.replaceChildren(container);
      }
      document.body.style.margin = '0';
      document.body.style.padding = '20px';
      document.body.style.background = '#f8fafc';
    })();
  `);

  await searchPage.waitForTimeout(500);

  // Save 1280x800 viewport screenshot focused on the hotel-results-list-container
  await searchPage.screenshot({ path: path.join(imagesDir, 'search-screenshot.png') });
  console.log('Search screenshot captured.');
  await searchPage.close();

  // ==========================================
  // 2. Maps Screenshot (search-results-map)
  // ==========================================
  console.log('2/4 Capturing Maps screen...');
  const mapPage = await context.newPage();
  await setupPageRoutes(mapPage);
  await mapPage.goto(`http://www.aadvantagehotels.com/search?view=map`, { waitUntil: 'domcontentloaded' });

  // Add styles so map and pins container expand properly
  await mapPage.addStyleTag({
    content: `
      [data-testid="search-results-map"], .css-mqhu8l, .sc-epALIP {
        height: 800px !important;
        min-height: 800px !important;
        width: 100% !important;
        position: relative !important;
        background-color: #e5e3df !important;
      }
      .gm-style {
        background-color: #e5e3df !important;
      }
    `,
  });

  const pin12498 = mapPage.locator('[data-testid="hotel-pin-12498"]');
  await pin12498.waitFor({ state: 'visible', timeout: 10000 });

  await mapPage.evaluate(`
    (async () => {
      await fetch('http://www.aadvantagehotels.com/rest/aadvantage-hotels/search/results');
    })();
  `);

  await mapPage.locator('[data-testid="hotel-pin-12498"][data-aa-mpd]').waitFor({ state: 'visible', timeout: 10000 });

  // Format map container to fill 1280x800 view cleanly
  await mapPage.evaluate(`
    (() => {
      const mapContainer = document.querySelector('[data-testid="search-results-map"]');
      const banner = document.getElementById('aa-mpd-search-summary');

      if (mapContainer) {
        mapContainer.style.height = '800px';
        mapContainer.style.minHeight = '800px';
        mapContainer.style.width = '1280px';
        mapContainer.style.position = 'relative';
        document.body.replaceChildren(mapContainer);
      }

      // Attach floating summary banner on map
      if (banner && mapContainer) {
        mapContainer.insertAdjacentElement('afterbegin', banner);
        banner.style.position = 'absolute';
        banner.style.top = '16px';
        banner.style.left = '50%';
        banner.style.transform = 'translateX(-50%)';
        banner.style.zIndex = '1000';
        banner.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        banner.style.width = '700px';
        banner.style.maxWidth = '90%';
      }
      document.body.style.margin = '0';
      document.body.style.padding = '0';
    })();
  `);

  // Anonymize in DOM
  await mapPage.evaluate(anonymizeSearchAndDetailsStr);
  await mapPage.waitForTimeout(500);

  await mapPage.screenshot({ path: path.join(imagesDir, 'maps-screenshot.png') });
  console.log('Maps screenshot captured.');
  await mapPage.close();

  // ==========================================
  // 3. Details Screenshot (room-group)
  // ==========================================
  console.log('3/4 Capturing Details screen...');
  const detailsPage = await context.newPage();
  await setupPageRoutes(detailsPage);
  await detailsPage.goto(
    `http://www.aadvantagehotels.com/details?hotelId=12498&checkIn=10%2F04%2F2026&checkOut=10%2F10%2F2026&currency=USD`,
    { waitUntil: 'domcontentloaded' }
  );
  const detailsBanner = detailsPage.locator('#aa-mpd-details-summary');
  await detailsBanner.waitFor({ state: 'visible', timeout: 10000 });
  await detailsPage.locator('.aa-mpd-badge').first().waitFor({ state: 'visible', timeout: 5000 });

  // Anonymize in DOM
  await detailsPage.evaluate(anonymizeSearchAndDetailsStr);

  // Format details page so room-group container with MPD badges is in direct focus
  await detailsPage.evaluate(`
    (() => {
      const banner = document.getElementById('aa-mpd-details-summary');
      const roomGroup = document.querySelector('[data-testid="room-group"]');
      if (banner && roomGroup) {
        banner.style.marginBottom = '20px';
        roomGroup.insertAdjacentElement('afterbegin', banner);
      }

      if (roomGroup) {
        roomGroup.style.margin = '16px auto';
        roomGroup.style.maxWidth = '1000px';
        document.body.replaceChildren(roomGroup);
      }
      document.body.style.margin = '0';
      document.body.style.padding = '16px';
      document.body.style.background = '#f8fafc';
    })();
  `);

  await detailsPage.waitForTimeout(500);

  await detailsPage.screenshot({ path: path.join(imagesDir, 'details-screenshot.png') });
  await detailsPage.screenshot({ path: path.join(imagesDir, 'card-screenshot.png') });
  console.log('Details screenshot captured.');
  await detailsPage.close();

  // ==========================================
  // 4. Options Dashboard Screenshot
  // ==========================================
  console.log('4/4 Capturing Options Dashboard screen...');
  const optionsPage = await context.newPage();
  await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);

  // Anonymize names with Lorem Ipsum and consistent random locations
  await optionsPage.evaluate(`
    (async () => {
      const words = ['Lorem', 'Ipsum', 'Dolor', 'Sit', 'Amet', 'Consectetur', 'Adipiscing', 'Elit'];
      const prefixes = ['The', 'Grand', 'Royal', 'Luxury', 'Classic'];
      const suffixes = ['Hotel', 'Resort', 'Suites', 'Inn', 'Plaza'];
      const getRandomHotelName = () => {
        const p = prefixes[Math.floor(Math.random() * prefixes.length)];
        const w = words[Math.floor(Math.random() * words.length)];
        const s = suffixes[Math.floor(Math.random() * suffixes.length)];
        return p + ' ' + w + ' ' + s;
      };
      
      const cities = ['Metropolis', 'Riverdale', 'Springfield', 'Gotham', 'Star City'];
      const states = ['NY', 'CA', 'TX', 'FL', 'IL'];
      const getRandomLocation = () => {
        const c = cities[Math.floor(Math.random() * cities.length)];
        const s = states[Math.floor(Math.random() * states.length)];
        return c + ', ' + s + ', USA';
      };

      const loc1 = getRandomLocation();
      const loc2 = getRandomLocation();
      const loc3 = getRandomLocation();

      const batches = [
        {
          criteria: { location: loc1, checkIn: "2026-10-14", checkOut: "2026-10-19", nights: 5, rooms: 1, guests: 2, timestamp: "2026-09-20T12:00:00.000Z", url: "mock" },
          rates: [
            { hotelName: getRandomHotelName(), location: loc1, neighborhood: "Downtown", country: "United States", price: 2450, basePrice: 2050, allInPrice: 2450, miles: 61250, mpd: 25.0, isTotalPrice: true, isBonus: false, stars: 5, rating: 9.3, reviewCount: 1420, refundable: true, chain: "Marriott", imageUrl: "https://cache.marriott.com/content/dam/marriott-renditions/HNLFL/hnlfl-exterior-0036-hor-feat.jpg?output-quality=70&interpolation=progressive-bilinear&downsize=1180px:*" },
            { hotelName: getRandomHotelName(), location: loc1, neighborhood: "Downtown", country: "United States", price: 3100, basePrice: 2600, allInPrice: 3100, miles: 68200, mpd: 22.0, isTotalPrice: true, isBonus: false, stars: 5, rating: 9.6, reviewCount: 980, refundable: true, chain: "Independent / Other" }
          ]
        },
        {
          criteria: { location: loc2, checkIn: "2026-11-05", checkOut: "2026-11-08", nights: 3, rooms: 1, guests: 2, timestamp: "2026-09-21T08:30:00.000Z", url: "mock" },
          rates: [
            { hotelName: getRandomHotelName(), location: loc2, neighborhood: "Uptown", country: "United States", price: 1800, basePrice: 1550, allInPrice: 1800, miles: 41400, mpd: 23.0, isTotalPrice: true, isBonus: false, stars: 5, rating: 9.4, reviewCount: 1850, refundable: true, chain: "Hilton" },
            { hotelName: getRandomHotelName(), location: loc2, neighborhood: "Westside", country: "United States", price: 1950, miles: 37050, mpd: 19.0, isTotalPrice: true, isBonus: false, stars: 5, rating: 9.2, refundable: true, chain: "Hyatt" }
          ]
        },
        {
          criteria: { location: loc3, checkIn: "2026-10-23", checkOut: "2026-10-25", nights: 2, rooms: 1, guests: 2, timestamp: "2026-09-22T14:15:00.000Z", url: "mock" },
          rates: [
            { hotelName: getRandomHotelName(), location: loc3, neighborhood: "Eastside", country: "United States", price: 2200, miles: 26400, mpd: 12.0, isTotalPrice: true, isBonus: false, stars: 5, rating: 9.5, refundable: true, chain: "Marriott" },
            { hotelName: getRandomHotelName(), location: loc3, neighborhood: "Central", country: "United States", price: 950, miles: 19000, mpd: 20.0, isTotalPrice: true, isBonus: false, stars: 4.5, rating: 8.9, refundable: true, chain: "IHG" }
          ]
        }
      ];

      for (let i = 0; i < batches.length; i++) {
        const b = batches[i];
        await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { type: "RECORD_RATES", criteria: b.criteria, rates: b.rates },
            () => resolve(true)
          );
        });
      }
    })();
  `);

  await optionsPage.waitForTimeout(1000);
  await optionsPage.reload();
  await optionsPage.locator('#top3VisualContainer').waitFor({ state: 'visible', timeout: 5000 });
  await optionsPage.locator('#topMpdsTable tbody tr').first().waitFor({ state: 'visible', timeout: 5000 });

  // Anonymize DOM before taking screenshot to guarantee all hotel names are Lorem Ipsum and locations are random & consistent
  await optionsPage.evaluate(`
    (() => {
      const words = ['Lorem', 'Ipsum', 'Dolor', 'Sit', 'Amet', 'Consectetur', 'Adipiscing', 'Elit'];
      const prefixes = ['The', 'Grand', 'Royal', 'Luxury', 'Classic'];
      const suffixes = ['Hotel', 'Resort', 'Suites', 'Inn', 'Plaza'];
      const getRandomHotelName = () => {
        const p = prefixes[Math.floor(Math.random() * prefixes.length)];
        const w = words[Math.floor(Math.random() * words.length)];
        const s = suffixes[Math.floor(Math.random() * suffixes.length)];
        return p + ' ' + w + ' ' + s;
      };
      
      const cities = ['Metropolis', 'Riverdale', 'Springfield', 'Gotham', 'Star City'];
      const states = ['NY', 'CA', 'TX', 'FL', 'IL'];
      const getRandomLocation = () => {
        const c = cities[Math.floor(Math.random() * cities.length)];
        const s = states[Math.floor(Math.random() * states.length)];
        return c + ', ' + s;
      };

      const hotelNameMap = new Map();
      const getAnon = (key) => {
        if (!hotelNameMap.has(key)) {
          hotelNameMap.set(key, {
            hotel: getRandomHotelName(),
            location: getRandomLocation(),
            neighborhood: words[Math.floor(Math.random() * words.length)] + ' District'
          });
        }
        return hotelNameMap.get(key);
      };

      // 1. Top 3 visual cards
      document.querySelectorAll('.property-card').forEach(card => {
        const titleEl = card.querySelector('.property-card-title');
        const locEl = card.querySelector('.property-card-location');
        if (titleEl) {
          const orig = titleEl.textContent || '';
          const info = getAnon(orig);
          titleEl.textContent = info.hotel;
          if (locEl) {
            locEl.innerHTML = '📍 <b>' + info.neighborhood + '</b> · <span style="font-size: 12px; color: var(--text-muted);">' + info.location + '</span>';
          }
        }
      });

      // 2. Deals Table rows
      document.querySelectorAll('#topMpdsTable tbody tr').forEach(tr => {
        const hotelTd = tr.querySelector('td:nth-child(5)');
        const locTd = tr.querySelector('td:nth-child(7)');
        if (hotelTd) {
          const orig = hotelTd.textContent || '';
          const info = getAnon(orig);
          // Preserve star and rating badges if any
          const stars = hotelTd.querySelector('.star-rating')?.outerHTML || '';
          const rating = hotelTd.querySelector('.pill-badge')?.outerHTML || '';
          hotelTd.innerHTML = '<div style="font-weight:600;">' + info.hotel + '</div>' + stars + rating;
          if (locTd) {
            locTd.textContent = info.location;
          }
        }
      });

      // 3. Location Stats tables
      document.querySelectorAll('#topLocsTable tbody tr, #lowestLocsTable tbody tr').forEach(tr => {
        const locTd = tr.querySelector('td:first-child');
        const hotelTd = tr.querySelector('td:nth-child(3)');
        if (hotelTd) {
          const orig = hotelTd.textContent || '';
          const info = getAnon(orig);
          hotelTd.textContent = info.hotel;
          if (locTd) {
            locTd.textContent = info.location;
          }
        }
      });

      // 4. Night Cards
      document.querySelectorAll('.night-card').forEach(card => {
        const sub = card.querySelector('.night-card-sub');
        if (sub && sub.textContent) {
          const info = getAnon(sub.textContent);
          sub.textContent = info.hotel;
        }
      });
    })();
  `);

  await optionsPage.waitForTimeout(300);

  await optionsPage.screenshot({ path: path.join(imagesDir, 'options-dashboard-screenshot.png') });
  console.log('Options Dashboard screenshot captured.');
  await optionsPage.close();

  console.log('All 4 main screen screenshots captured successfully!');
  await context.close();
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

captureScreenshots().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
