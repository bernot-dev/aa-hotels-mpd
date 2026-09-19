import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { extractNumber, processCard, updateCards } from '../src/cards';
import { getNights } from '../src/nights';
import { getRouteType } from '../src/router';

describe('Router & Route Type Detection', () => {
  it('correctly classifies search and details routes', () => {
    expect(getRouteType('https://www.aadvantagehotels.com/search?destination=Dallas')).toBe('search');
    expect(getRouteType('https://www.aadvantagehotels.com/details?id=123')).toBe('details');
    expect(getRouteType('https://www.aadvantagehotels.com/')).toBe('other');
    expect(getRouteType('https://www.aadvantagehotels.com/checkout/456')).toBe('other');
  });
});

describe('getNights Safe Parsing', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('calculates nights from search params correctly', () => {
    delete (window as any).location;
    window.location = new URL('https://www.aadvantagehotels.com/search?checkIn=2026-10-01&checkOut=2026-10-04') as any;

    expect(getNights()).toBe(3);

    window.location = originalLocation;
  });

  it('safely defaults to 1 night when parameters are missing without throwing', () => {
    delete (window as any).location;
    window.location = new URL('https://www.aadvantagehotels.com/search') as any;

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

describe('Search Fixture Processing (search-guest.html)', () => {
  const searchHtmlPath = path.resolve(__dirname, '../fixtures/search-guest.html');
  const searchHtml = fs.readFileSync(searchHtmlPath, 'utf-8');

  it('processes all 44 cards in search-guest.html idempotently without errors', () => {
    const dom = new JSDOM(searchHtml);
    const doc = dom.window.document;

    const cards = doc.querySelectorAll('[data-testid="hotel-card-pricing"]');
    expect(cards.length).toBe(44);

    let totalProcessed = 0;
    let highestMPD = 0;

    cards.forEach((card) => {
      const { cardMaxMPD, processedTiers } = processCard(card, 2, false);
      if (processedTiers > 0) {
        totalProcessed++;
      }
      if (cardMaxMPD > highestMPD) {
        highestMPD = cardMaxMPD;
      }
    });

    expect(totalProcessed).toBe(44);
    expect(highestMPD).toBeGreaterThan(0);

    // Verify badges are present
    const badges = doc.querySelectorAll('.aa-mpd-badge');
    expect(badges.length).toBeGreaterThan(44);

    // Verify idempotency: running processCard again should not create duplicate badges
    cards.forEach((card) => {
      processCard(card, 2, false);
    });

    const badgesAfterSecondRun = doc.querySelectorAll('.aa-mpd-badge');
    expect(badgesAfterSecondRun.length).toBe(badges.length);
  });
});

describe('Details Fixture Processing & Bonus Miles Logic (details-guest.html)', () => {
  const detailsHtmlPath = path.resolve(__dirname, '../fixtures/details-guest.html');
  const detailsHtml = fs.readFileSync(detailsHtmlPath, 'utf-8');

  it('skips boost tags when includeBonusMiles is false', () => {
    const dom = new JSDOM(detailsHtml);
    const doc = dom.window.document;

    const roomCards = doc.querySelectorAll('[data-testid="room-card"]');
    expect(roomCards.length).toBe(10);

    let processedCount = 0;
    roomCards.forEach((card) => {
      const { processedTiers } = processCard(card, 2, false);
      if (processedTiers > 0) {
        processedCount++;
      }
    });

    // 5 standard cards processed, 5 boost cards skipped
    expect(processedCount).toBe(5);
  });

  it('processes boost tags when includeBonusMiles is true', () => {
    const dom = new JSDOM(detailsHtml);
    const doc = dom.window.document;

    const roomCards = doc.querySelectorAll('[data-testid="room-card"]');
    expect(roomCards.length).toBe(10);

    let processedCount = 0;
    roomCards.forEach((card) => {
      const { processedTiers } = processCard(card, 2, true);
      if (processedTiers > 0) {
        processedCount++;
      }
    });

    // All 10 cards processed including boosted offers
    expect(processedCount).toBe(10);
  });
});

describe('End-to-End updateCards Runner', () => {
  it('updates container and creates summary banner', () => {
    const dom = new JSDOM(`
      <div id="container">
        <div data-testid="hotel-card-pricing">
          <div data-testid="pricing-text">Total (2 nights)</div>
          <div data-testid="earn-price">$200</div>
          <div data-testid="tier-earn-rewards">Earn 5,000 miles per stay</div>
        </div>
      </div>
    `);
    const doc = dom.window.document;
    const container = doc.getElementById('container')!;
    const maxBanner = doc.createElement('div');

    // Run synchronous update
    const update = updateCards(container, maxBanner, '[data-testid="hotel-card-pricing"]', false);
    update();

    // Trigger scheduled RAF callback directly
    const badge = container.querySelector('.aa-mpd-badge');
    // In our test, setTimeout(runUpdate, 16) is used if RAF is undefined in node environment
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
