import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import {
  extractNumber,
  extractPrice,
  innermostCards,
  isTotalPriceText,
  processCard,
  updateCards,
  CARD_SELECTOR,
  ROOM_CARD_SELECTOR,
} from '../src/cards';
import { getNights } from '../src/nights';
import { getRouteType } from '../src/router';

describe('Router & Route Type Detection', () => {
  it('correctly classifies search and details routes', () => {
    expect(getRouteType('https://search.aadvantagehotels.com/search?destination=Dallas')).toBe('search');
    expect(getRouteType('https://search.aadvantagehotels.com/accom/property?propertyId=123')).toBe('details');
    expect(getRouteType('https://search.aadvantagehotels.com/')).toBe('search');
    expect(getRouteType('https://search.aadvantagehotels.com/checkout/456')).toBe('other');
  });

  it('classifies live Agoda search and hotel URLs', () => {
    expect(getRouteType('https://search.aadvantagehotels.com/search?cid=1951050&city=8683&checkIn=2026-11-12&los=2')).toBe('search');
    expect(
      getRouteType('https://search.aadvantagehotels.com/la-quinta-inn-dallas-uptown_3/hotel/dallas-tx-us.html?countryId=181&checkIn=2026-11-12&los=2')
    ).toBe('details');
  });
});

describe('Price parsing', () => {
  it('treats "N nights including taxes and fees" and "Total" as total-stay prices', () => {
    expect(isTotalPriceText('2 nights including taxes and fees')).toBe(true);
    expect(isTotalPriceText('1 night including taxes and fees')).toBe(true);
    expect(isTotalPriceText('Total (2 nights)')).toBe(true);
    expect(isTotalPriceText('')).toBe(true);
    expect(isTotalPriceText('per night')).toBe(false);
    expect(isTotalPriceText('$120/night')).toBe(false);
    expect(isTotalPriceText('Avg. nightly price')).toBe(false);
  });

  it('reads data-fpc-value and rejects non-USD prices', () => {
    const el = document.createElement('span');
    el.setAttribute('data-fpc-value', '1112');
    el.textContent = 'USD 1,112';
    expect(extractPrice(el)).toBe(1112);
    el.textContent = 'EUR 1,112';
    expect(extractPrice(el)).toBeNull();
    const legacy = document.createElement('span');
    legacy.textContent = '$557';
    expect(extractPrice(legacy)).toBe(557);
  });
});

describe('getNights Safe Parsing', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('calculates nights from search params correctly', () => {
    delete (window as any).location;
    window.location = new URL('https://search.aadvantagehotels.com/search?checkIn=2026-10-01&checkOut=2026-10-04') as any;

    expect(getNights()).toBe(3);

    window.location = originalLocation;
  });

  it('uses the los (length of stay) param when there is no check-out date', () => {
    delete (window as any).location;
    window.location = new URL('https://search.aadvantagehotels.com/x/hotel/dallas-tx-us.html?checkIn=2026-11-12&los=3') as any;

    expect(getNights()).toBe(3);

    window.location = originalLocation;
  });

  it('safely defaults to 1 night when parameters are missing without throwing', () => {
    delete (window as any).location;
    window.location = new URL('https://search.aadvantagehotels.com/search') as any;

    expect(getNights()).toBe(1);

    window.location = originalLocation;
  });
});

describe('extractNumber', () => {
  it('extracts clean numbers from formatted currency and counts', () => {
    const el = document.createElement('div');
    el.textContent = '$1,250.00 Total';
    expect(extractNumber(el)).toBe(1250);

    el.textContent = 'Earn 5,300 miles per stay';
    expect(extractNumber(el)).toBe(5300);
  });

  it('ignores text inside injected .aa-mpd-badge elements', () => {
    const el = document.createElement('div');
    el.textContent = 'Earn 400 miles per stay';
    const badge = document.createElement('span');
    badge.className = 'aa-mpd-badge';
    badge.textContent = ' (14.2 miles/$)';
    el.appendChild(badge);

    expect(extractNumber(el)).toBe(400);
  });
});

const isMilesCaption = (el: Element) => /Earn [\d,]+ miles/.test(el.textContent || '');

describe('Search Fixture Processing (search-guest.html)', () => {
  const searchHtmlPath = path.resolve(__dirname, '../fixtures/search-guest.html');
  const searchHtml = fs.readFileSync(searchHtmlPath, 'utf-8');

  it('badges every miles tier on every priced card, idempotently', () => {
    const dom = new JSDOM(searchHtml);
    const doc = dom.window.document;

    const cards = Array.from(doc.querySelectorAll(CARD_SELECTOR));
    const pricedCards = cards.filter((c) => c.querySelector('[data-element-name="fpc-room-price"]'));
    const milesCaptions = pricedCards.flatMap((c) =>
      Array.from(c.querySelectorAll('[data-testid="upc_caption"]')).filter(isMilesCaption)
    );
    expect(pricedCards.length).toBeGreaterThan(0);

    let totalProcessed = 0;
    let highestMPD = 0;
    cards.forEach((card) => {
      const { cardMaxMPD, processedTiers } = processCard(card, 2, false);
      if (processedTiers > 0) totalProcessed++;
      highestMPD = Math.max(highestMPD, cardMaxMPD);
    });

    // Unpriced cards (sold out / not yet rendered) are skipped
    expect(totalProcessed).toBe(pricedCards.length);
    expect(highestMPD).toBeGreaterThan(0);

    const badges = doc.querySelectorAll('.aa-mpd-badge');
    expect(badges.length).toBe(pricedCards.length);
    // Badges go into property-card-info
    badges.forEach((b) => expect(b.parentElement!.getAttribute('data-element-name')).toBe('property-card-info'));

    // First card: chip includes all-in price and mpd
    const first = pricedCards[0];
    const price = Number(first.querySelector('[data-element-name="fpc-room-price"]')!.getAttribute('data-fpc-value'));
    const firstInfo = first.querySelector('[data-element-name="property-card-info"]')!;
    const chip = firstInfo.querySelector('.aa-mpd-badge')!;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain(`$${price} all-in`);
    expect(chip.textContent).toContain('mpd');

    // Idempotency: running processCard again should not create duplicate badges
    cards.forEach((card) => processCard(card, 2, false));
    expect(doc.querySelectorAll('.aa-mpd-badge').length).toBe(badges.length);
  });
});

describe('Details Fixture Processing & Bonus Miles Logic (details-guest.html)', () => {
  const detailsHtmlPath = path.resolve(__dirname, '../fixtures/details-guest.html');
  const detailsHtml = fs.readFileSync(detailsHtmlPath, 'utf-8');

  it('badges every room row; headline follows the earning level', () => {
    const doc = new JSDOM(detailsHtml).window.document;
    const rows = innermostCards(doc.querySelectorAll(ROOM_CARD_SELECTOR));
    expect(rows.length).toBe(doc.querySelectorAll('[data-selenium="ChildRoomsList-room"]').length);

    rows.forEach((row) => {
      const tiers = Array.from(row.querySelectorAll('[data-testid="upc_caption"]')).filter(isMilesCaption);
      const memberRate = processCard(row, 2, false, true, false, 'member');
      expect(memberRate.processedTiers).toBe(tiers.length);
      const statusRate = processCard(row, 2, false, true, false, 'status_cardmember');
      expect(statusRate.cardMaxMPD).toBeGreaterThanOrEqual(memberRate.cardMaxMPD);
      expect((row as HTMLElement).dataset.aaMpdRate).toBe(String(statusRate.cardMaxMPD));
    });
    expect(doc.querySelectorAll('.aa-mpd-badge').length).toBeGreaterThanOrEqual(rows.length);
  });

  it('skips boosted rooms unless includeBonusMiles is true', () => {
    const doc = new JSDOM(detailsHtml).window.document;
    const row = doc.querySelector('[data-selenium="ChildRoomsList-room"]')!;
    const boost = doc.createElement('div');
    boost.setAttribute('data-selenium', 'boost-tag');
    boost.textContent = 'Earn 2,000 bonus miles!';
    row.prepend(boost);

    expect(processCard(row, 2, false, true, false).processedTiers).toBe(0);
    expect(row.querySelectorAll('.aa-mpd-badge').length).toBe(0);
    expect(processCard(row, 2, true, true, false).processedTiers).toBeGreaterThan(0);
  });
});

describe('End-to-End updateCards Runner', () => {
  it('updates container and creates summary banner', () => {
    const dom = new JSDOM(`
      <div id="container">
        <div class="PropertyCardItem" data-selenium="hotel-item">
          <div data-selenium="hotel-currency" class="PropertyCardPrice__Currency">Total (2 nights)</div>
          <div data-selenium="display-price" class="PropertyCardPrice__Value">$200</div>
          <div data-selenium="points-max-promo-text">Earn 5,000 miles per stay</div>
        </div>
      </div>
    `);
    const doc = dom.window.document;
    const container = doc.getElementById('container')!;
    const maxBanner = doc.createElement('div');

    // Run synchronous update
    const update = updateCards(container, maxBanner, 'li.PropertyCardItem, [data-selenium="hotel-item"]', false);
    update();

    // Trigger scheduled RAF callback directly
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const badgeAfter = container.querySelector('.aa-mpd-badge');
        expect(badgeAfter).not.toBeNull();
        expect(badgeAfter?.textContent).toContain('25.0');
        expect(maxBanner.textContent).toContain('Best earn rate on this page');
        resolve();
      }, 50);
    });
  });
});
