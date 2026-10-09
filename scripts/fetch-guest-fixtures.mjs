// Captures guest-mode test fixtures from the live search.aadvantagehotels.com (Agoda white label).
//
// Every page normally bounces through login.aa.com SSO (prompt=none), which blocks headless
// browsers. Setting the `seamless_sso_attempted=1` cookie skips that bounce and serves guest mode.
//
// Outputs (fixtures/):
//   search-guest.html          results page 1, all cards rendered, scripts stripped
//   search-map-guest.html      results page with the map open (property markers)
//   details-guest.html         hotel page with room grid
//   search-graphql-guest.json  { request, response } for the page-1 graphql/search call, trimmed
//
// Usage: node scripts/fetch-guest-fixtures.mjs [cityId] (default 8683 = Dallas, TX)
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = path.resolve(projectRoot, 'fixtures');
fs.mkdirSync(fixturesDir, { recursive: true });

const ORIGIN = 'https://search.aadvantagehotels.com';
const cityId = process.argv[2] || '8683';
const checkIn = new Date(Date.now() + 35 * 86400000).toISOString().slice(0, 10);
const checkOut = new Date(Date.parse(checkIn) + 2 * 86400000).toISOString().slice(0, 10);
const SEARCH_URL =
  `${ORIGIN}/search?cid=1951050&city=${cityId}&checkIn=${checkIn}&checkOut=${checkOut}&los=2` +
  '&rooms=1&adults=2&children=0&loyaltySearchType=EARN&currencyCode=USD&locale=en-us';

// Removes scripts and other active or external content so fixtures load offline and inertly.
function sanitize(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/<input\b[^>]*RequestVerificationToken[^>]*>/gi, '');
}

// Keeps the fields the extension reads; drops supplier lists, filters and other bulk.
function trimSearchResponse(response, keep = 12) {
  const result = structuredClone(response);
  const search = result.data?.citySearch;
  if (search) {
    search.properties = search.properties.slice(0, keep).map((p) => {
      if (p.pricing) delete p.pricing.suppliersSummaries;
      if (p.content) {
        delete p.content.localInformation;
        delete p.content.familyFeatures;
        delete p.content.facilities;
        if (p.content.images?.hotelImages) p.content.images.hotelImages = p.content.images.hotelImages.slice(0, 1);
        if (p.content.reviews) p.content.reviews = { cumulative: p.content.reviews.cumulative };
      }
      delete p.enrichment;
      delete p.metaLab;
      return p;
    });
    delete search.aggregation;
    if (search.searchResult) {
      delete search.searchResult.histogram;
      delete search.searchResult.sortMatrix;
      if (search.searchResult.searchInfo?.objectInfo) delete search.searchResult.searchInfo.objectInfo.cityCenterPolygon;
    }
  }
  return result;
}

async function renderAllCards(page) {
  for (let i = 0; i < 15; i++) {
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

function save(name, content) {
  fs.writeFileSync(path.join(fixturesDir, name), content);
  console.log(`Saved ${name} (${(content.length / 1024).toFixed(0)} KB)`);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-fixtures-'));
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  viewport: { width: 1400, height: 950 },
  userAgent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
});
const ssoCookie = () =>
  context.addCookies([
    { name: 'seamless_sso_attempted', value: '1', domain: 'search.aadvantagehotels.com', path: '/', expires: Math.floor(Date.now() / 1000) + 3600 },
  ]);

try {
  const page = await context.newPage();
  let searchCall = null;
  page.on('response', async (response) => {
    if (searchCall || !response.url().includes('/graphql/search')) return;
    try {
      const request = JSON.parse(response.request().postData() || '{}');
      const json = await response.json();
      if (json.data?.citySearch?.properties?.length) searchCall = { request, response: json };
    } catch {
      // Not the results call
    }
  });

  await ssoCookie();
  await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('li.PropertyCardItem').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(3000);
  await renderAllCards(page);
  save('search-guest.html', sanitize(await page.content()));
  if (!searchCall) throw new Error('No graphql/search response captured');
  save('search-graphql-guest.json', JSON.stringify({ request: searchCall.request, response: trimSearchResponse(searchCall.response) }, null, 1));

  await page.locator('button:has-text("Show on map")').first().click();
  await page.locator('[data-element-name="map-search-property-marker"]').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(3000);
  save('search-map-guest.html', sanitize(await page.content()));

  const propertyPage = searchCall.response.data.citySearch.properties.find(
    (p) => p.content?.informationSummary?.propertyLinks?.propertyPage && p.pricing?.offers?.length
  ).content.informationSummary.propertyLinks.propertyPage;
  await ssoCookie();
  await page.goto(`${ORIGIN}${propertyPage}?cid=1951050&checkIn=${checkIn}&los=2&rooms=1&adults=2&children=0&currencyCode=USD&loyaltySearchType=EARN`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.locator('[data-selenium="ChildRoomsList-room"]').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(3000);
  save('details-guest.html', sanitize(await page.content()));
} finally {
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
