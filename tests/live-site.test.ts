// Regression tests against real captures of the redesigned search.aadvantagehotels.com
// (Agoda white label). Regenerate the fixtures with `node scripts/fetch-guest-fixtures.mjs`.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import {
  extractHotelRatesFromPayload,
  extractAgodaRequestCriteria,
  getSearchKey,
  isFinalAvailabilityPoll,
  wrapFetch,
} from '../src/interceptor';
import { updateSummaryBanner } from '../src/search-query';
import {
  clearHotelMpdRegistry,
  getCurrentPageBestMPD,
  getHotelIdFromPin,
  hotelMpdRegistry,
  ingestHotelRates,
  getSearchTotalResults,
  setSearchTotalResults,
} from '../src/registry';
import { updateMapPins, PIN_SELECTOR } from '../src/map';
import { processSearchPage } from '../src/search';

const fixturesDir = path.resolve(__dirname, '../fixtures');
const searchCall = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'search-graphql-guest.json'), 'utf-8'));
const properties: any[] = searchCall.response.data.citySearch.properties;
const pricedProperties = properties.filter((p) => p.pricing?.offers?.[0]?.roomOffers?.[0]?.room?.pricing?.[0]?.price?.perBook);

const perBookOf = (p: any) => p.pricing.offers[0].roomOffers[0].room.pricing[0].price.perBook;

describe('Agoda GraphQL search payload (search-graphql-guest.json)', () => {
  beforeEach(() => clearHotelMpdRegistry());

  it('extracts every priced property from data.citySearch.properties', () => {
    const rates = extractHotelRatesFromPayload(searchCall.response, JSON.stringify(searchCall.request));
    expect(pricedProperties.length).toBeGreaterThan(0);
    expect(rates.map((r) => r.hotelId).sort()).toEqual(pricedProperties.map((p) => String(p.propertyId)).sort());
  });

  it('reads prices, miles tiers, and content from the first displayed room offer', () => {
    const rates = extractHotelRatesFromPayload(searchCall.response, searchCall.request);
    const property = pricedProperties[0];
    const perBook = perBookOf(property);
    const offers: any[] = perBook.inclusive.loyaltyOfferSummary.offers;
    const rate = rates.find((r) => r.hotelId === String(property.propertyId))!;

    expect(rate.hotelName).toBe(property.content.informationSummary.displayName);
    expect(rate.allInPrice).toBe(perBook.inclusive.display);
    expect(rate.basePrice).toBe(perBook.exclusive.display);
    expect(rate.baseMiles).toBe(offers.find((o) => o.status === 'ENABLED').earn.points);
    expect(rate.tieredMiles).toBe(Math.max(...offers.map((o) => o.earn.points)));
    expect(rate.tieredMiles).toBeGreaterThanOrEqual(rate.baseMiles);
    expect(rate.location).toMatch(/^[A-Za-z .'-]+, [A-Z]{2}$/);
    expect(rate.country).toBe('United States');
  });

  it('takes stay dates from the request body, which the response omits', () => {
    const criteria = searchCall.request.variables.CitySearchRequest.searchRequest.searchCriteria;
    const parsed = extractAgodaRequestCriteria(JSON.stringify(searchCall.request));
    expect(parsed.checkInDate).toBe(criteria.localCheckInDate);
    expect(parsed.nights).toBe(criteria.los);
    const expectedOut = new Date(`${criteria.localCheckInDate}T00:00:00Z`);
    expectedOut.setUTCDate(expectedOut.getUTCDate() + criteria.los);
    expect(parsed.checkOutDate).toBe(expectedOut.toISOString().slice(0, 10));

    const rates = extractHotelRatesFromPayload(searchCall.response, JSON.stringify(searchCall.request));
    expect(rates[0].checkInDate).toBe(parsed.checkInDate);
    expect(rates[0].checkOutDate).toBe(parsed.checkOutDate);
    expect(rates[0].nights).toBe(parsed.nights);
  });

  it('handles other Agoda search operations (data.<x>Search.properties)', () => {
    const areaPayload = { data: { areaSearch: { properties: [pricedProperties[0]] } } };
    expect(extractHotelRatesFromPayload(areaPayload)).toHaveLength(1);
  });

  it('skips non-USD prices', () => {
    const property = structuredClone(pricedProperties[0]);
    property.pricing.offers[0].roomOffers[0].room.pricing[0].currency = 'EUR';
    expect(extractHotelRatesFromPayload({ data: { citySearch: { properties: [property] } } })).toHaveLength(0);
  });
});

describe('Fetch interception', () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearHotelMpdRegistry();
  });

  const latestRates = () => JSON.parse(sessionStorage.getItem('aa_hotels_latest_rates') || '[]');

  it('inspects the payload when the page reads response.json(), without needing a clone', async () => {
    // The live site aborts each GraphQL request after reading it, which errors unread clones
    const controller = new AbortController();
    const baseFetch = vi.fn(async () => new Response(JSON.stringify(searchCall.response)));
    const wrapped = wrapFetch(baseFetch as unknown as typeof fetch);

    const response = await wrapped('https://search.aadvantagehotels.com/graphql/search', {
      method: 'POST',
      body: JSON.stringify(searchCall.request),
      signal: controller.signal,
    });
    const data = await response.json();
    controller.abort();

    expect(data).toEqual(searchCall.response);
    expect(latestRates()).toHaveLength(pricedProperties.length);
  });

  it('inspects JSON read through response.text()', async () => {
    const wrapped = wrapFetch((async () => new Response(JSON.stringify(searchCall.response))) as unknown as typeof fetch);
    const response = await wrapped('https://search.aadvantagehotels.com/graphql/search');
    expect(JSON.parse(await response.text())).toEqual(searchCall.response);
    expect(latestRates()).toHaveLength(pricedProperties.length);
  });

  it('inspects each response once even when fetch is wrapped twice', async () => {
    const listener = vi.fn();
    window.addEventListener('AA_HOTELS_MPD_NETWORK_DATA', listener);
    const inner = wrapFetch((async () => new Response(JSON.stringify(searchCall.response))) as unknown as typeof fetch);
    // The page wraps our wrapper with its own; the interceptor then wraps the page's wrapper
    const pageWrapper = ((input: RequestInfo | URL, init?: RequestInit) => inner(input, init)) as typeof fetch;
    const outer = wrapFetch(pageWrapper);
    await (await outer('https://search.aadvantagehotels.com/graphql/search')).json();
    window.removeEventListener('AA_HOTELS_MPD_NETWORK_DATA', listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps intercepting after the page reassigns window.fetch', async () => {
    await import('../src/interceptor-main');
    window.fetch = (async () => new Response(JSON.stringify(searchCall.response))) as typeof fetch;
    await (await window.fetch('https://search.aadvantagehotels.com/graphql/search')).json();
    expect(latestRates()).toHaveLength(pricedProperties.length);
  });

  it('leaves unrelated endpoints alone', async () => {
    const wrapped = wrapFetch((async () => new Response(JSON.stringify(searchCall.response))) as unknown as typeof fetch);
    await (await wrapped('https://search.aadvantagehotels.com/api/cart/items')).json();
    expect(latestRates()).toHaveLength(0);
  });
});

describe('Registry: best rate on the current page', () => {
  beforeEach(() => clearHotelMpdRegistry());

  it('reports the best MPD among the latest payload only', () => {
    const rate = (hotelId: string, miles: number) => ({
      hotelId, hotelName: hotelId, price: 100, basePrice: 100, allInPrice: 100, nightlyPrice: 50, fees: 0,
      baseMiles: miles, tieredMiles: miles, city: 'Dallas', state: 'TX', location: 'Dallas, TX',
    });
    ingestHotelRates([rate('1', 3000), rate('2', 1000)]);
    expect(getCurrentPageBestMPD()).toBe(30);
    // Page 2 of the same search
    ingestHotelRates([rate('3', 500), rate('4', 800)]);
    expect(getCurrentPageBestMPD()).toBe(8);
  });
});

describe('One search across its result pages', () => {
  beforeEach(() => clearHotelMpdRegistry());

  // The site requests page 2 of a search with its own searchId and request time
  const requestFor = (pageNumber: number, searchId: string, bookingDate: string, checkIn?: string) => {
    const body = JSON.parse(JSON.stringify(searchCall.request));
    const sr = body.variables.CitySearchRequest.searchRequest;
    sr.page.pageNumber = pageNumber;
    sr.searchContext.searchId = searchId;
    sr.searchCriteria.bookingDate = bookingDate;
    if (checkIn) sr.searchCriteria.localCheckInDate = checkIn;
    return body;
  };
  const page1 = requestFor(1, 'id-page-1', '2026-10-10T13:43:05.422Z');
  const page2 = requestFor(2, 'id-page-2', '2026-10-10T13:43:07.926Z');

  it('shares a search key between pages but not between searches', () => {
    expect(getSearchKey(page1)).toBeDefined();
    expect(getSearchKey(page2)).toBe(getSearchKey(page1));
    expect(getSearchKey(JSON.stringify(page2))).toBe(getSearchKey(page1));
    // The site's final availability poll for the same page
    const finalPoll = JSON.parse(JSON.stringify(page2));
    finalPoll.variables.CitySearchRequest.searchRequest.searchCriteria.synchronous = true;
    expect(getSearchKey(finalPoll)).toBe(getSearchKey(page1));
    expect(getSearchKey(requestFor(1, 'id-page-1', '2026-10-10T13:43:05.422Z', '2026-12-01'))).not.toBe(getSearchKey(page1));
  });

  it("keeps page 1's hotels when the same search's page 2 arrives with a new searchId", () => {
    ingestHotelRates(extractHotelRatesFromPayload(searchCall.response, page1));
    const page1Count = hotelMpdRegistry.size;
    expect(page1Count).toBe(pricedProperties.length);

    const page2Response = JSON.parse(JSON.stringify(searchCall.response));
    page2Response.data.citySearch.properties = page2Response.data.citySearch.properties.slice(0, 1);
    ingestHotelRates(extractHotelRatesFromPayload(page2Response, page2));
    expect(hotelMpdRegistry.size).toBe(page1Count);
  });

  it('recognizes the final availability poll', () => {
    const finalPoll = JSON.parse(JSON.stringify(page2));
    finalPoll.variables.CitySearchRequest.searchRequest.searchCriteria.synchronous = true;
    expect(isFinalAvailabilityPoll(finalPoll)).toBe(true);
    expect(isFinalAvailabilityPoll(JSON.stringify(finalPoll))).toBe(true);
    expect(isFinalAvailabilityPoll(page2)).toBe(false);
    expect(isFinalAvailabilityPoll(undefined)).toBe(false);
  });

  it('settles on the final poll\'s count of hotels with rooms and explains the difference', () => {
    const key = getSearchKey(page1);
    setSearchTotalResults(920, key);
    setSearchTotalResults(916, key);
    expect(getSearchTotalResults()).toBe(920);

    setSearchTotalResults(709, key, true);
    expect(getSearchTotalResults()).toBe(709);
    // Background pages and later polls don't move it again
    setSearchTotalResults(905, key);
    setSearchTotalResults(700, key, true);
    expect(getSearchTotalResults()).toBe(709);

    // More hotels collected than remain bookable: the count is capped at the total
    for (let i = 0; i < 750; i++) hotelMpdRegistry.set(`h${i}`, 5);
    const banner = document.createElement('div');
    banner.id = 'aa-mpd-search-summary';
    updateSummaryBanner(banner, 12.3, false);
    const total = banner.querySelector<HTMLElement>('.aa-mpd-banner-total');
    expect(banner.textContent).toContain('(considering 709 of 709 properties)');
    expect(total?.textContent).toBe('709');
    expect(total?.title).toBe(
      'The search first matched 920 properties. 211 of them have no rooms available for these dates, which leaves 709.'
    );
  });

  it('shows the total without a tooltip until it settles', () => {
    setSearchTotalResults(920, getSearchKey(page1));
    hotelMpdRegistry.set('1', 5);
    const banner = document.createElement('div');
    banner.id = 'aa-mpd-search-summary';
    updateSummaryBanner(banner, 5, false);
    expect(banner.textContent).toContain('(considering 1 of 920 properties)');
    expect(banner.querySelector('.aa-mpd-banner-total')).toBeNull();
  });

  it("keeps a search's first total while later pages report drifting counts", () => {
    setSearchTotalResults(919, getSearchKey(page1));
    setSearchTotalResults(709, getSearchKey(page2));
    expect(getSearchTotalResults()).toBe(919);

    const otherSearch = getSearchKey(requestFor(1, 'x', 'y', '2026-12-01'));
    setSearchTotalResults(312, otherSearch);
    expect(getSearchTotalResults()).toBe(312);
  });
});

describe('Results page status (search-guest.html)', () => {
  beforeEach(() => clearHotelMpdRegistry());

  it('does not take one page of a multi-page search as the total', () => {
    const doc = new JSDOM(fs.readFileSync(path.join(fixturesDir, 'search-guest.html'), 'utf-8')).window.document;
    document.body.innerHTML = doc.body.innerHTML;
    // "Page 1 of 10", and a status line counting only this page's 90 cards
    expect(getSearchTotalResults()).toBeNull();

    const banner = document.createElement('div');
    banner.id = 'aa-mpd-search-summary';
    updateSummaryBanner(banner, 5, false);
    expect(banner.textContent).toContain('(considering 90 properties)');
    expect(banner.textContent).toContain('There may be better deals on additional pages.');
    document.body.innerHTML = '';
  });
});

describe('Live map markers (search-map-guest.html)', () => {
  beforeEach(() => clearHotelMpdRegistry());

  it('reads hotel IDs from Agoda property markers', () => {
    const marker = document.createElement('span');
    marker.setAttribute('data-selenium', 'propertyMarkerIcon-2461695');
    expect(getHotelIdFromPin(marker)).toBe('2461695');
    marker.setAttribute('data-id', '123');
    expect(getHotelIdFromPin(marker)).toBe('123');
  });

  it('colors every marker with a known rate, best in green', () => {
    const doc = new JSDOM(fs.readFileSync(path.join(fixturesDir, 'search-map-guest.html'), 'utf-8')).window.document;
    const markers = Array.from(doc.querySelectorAll<HTMLElement>('[data-element-name="map-search-property-marker"]'));
    expect(markers.length).toBeGreaterThan(0);
    expect(doc.querySelectorAll(PIN_SELECTOR).length).toBe(markers.length);

    ingestHotelRates(extractHotelRatesFromPayload(searchCall.response));
    updateMapPins(doc.body);

    const known = markers.filter((m) => hotelMpdRegistry.has(m.getAttribute('data-id')!));
    expect(known.length).toBeGreaterThan(0);
    known.forEach((m) => {
      expect(m.getAttribute('data-aa-mpd')).toBe(hotelMpdRegistry.get(m.getAttribute('data-id')!)!.toFixed(1));
      expect(m.querySelector<HTMLElement>('.propertyMarkerIcon-content')!.style.backgroundColor).not.toBe('');
    });

    const best = known.reduce((a, b) => (Number(b.getAttribute('data-aa-mpd')) > Number(a.getAttribute('data-aa-mpd')) ? b : a));
    expect(best.querySelector<HTMLElement>('.propertyMarkerIcon-content')!.style.backgroundColor).toBe('rgb(21, 128, 61)');
  });
});

describe('Search page with base pricing', () => {
  it('badges with the base price and settles without further DOM churn', async () => {
    clearHotelMpdRegistry();
    (globalThis as any).chrome = {
      storage: { sync: { get: vi.fn().mockResolvedValue({ pricingCalculationMethod: 'base', expandSearchResults: false }) } },
    };
    document.body.innerHTML = `<div id="searchPageRightColumn"><ol>
      <li class="PropertyCard PropertyCardItem" data-hotelid="1" data-selenium="hotel-item">
        <span data-testid="upc_caption">Earn 1,000 miles</span>
        <span data-testid="upc_caption" data-element-name="fpc-room-price" data-fpc-value="110">USD 110</span>
        <span data-testid="upc_caption" data-element-name="fpc-price-text">2 nights including taxes and fees</span>
      </li></ol></div>`;
    ingestHotelRates(
      [{ hotelId: '1', hotelName: 'X', price: 110, basePrice: 100, allInPrice: 110, nightlyPrice: 55, fees: 10, baseMiles: 1000, tieredMiles: 1000, city: 'Dallas', state: 'TX', location: 'Dallas, TX' }],
      false,
      false
    );

    let mutations = 0;
    const observer = new MutationObserver((m) => (mutations += m.length));
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const teardown = await processSearchPage(document.querySelector('#searchPageRightColumn')!);
    await new Promise((r) => setTimeout(r, 300));
    const settled = mutations;
    await new Promise((r) => setTimeout(r, 300));

    expect(document.querySelector('.aa-mpd-badge')?.textContent).toContain('10.0 mpd');
    expect(mutations).toBe(settled);
    observer.disconnect();
    teardown();
    delete (globalThis as any).chrome;
  });
});
