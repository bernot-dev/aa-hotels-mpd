import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { processSearchPage } from '../src/search';

describe('Search Page Presentation Regression Tests', () => {
  let container: HTMLDivElement;
  let wrapper: HTMLDivElement;
  let cleanupFn: (() => void) | null = null;

  beforeEach(() => {
    wrapper = document.createElement('div');
    container = document.createElement('div');
    container.setAttribute('data-testid', 'hotel-results-list-container');
    wrapper.appendChild(container);
    document.body.appendChild(wrapper);
  });

  afterEach(() => {
    if (cleanupFn) {
      cleanupFn();
      cleanupFn = null;
    }
    document.body.innerHTML = '';
  });

  const createHotelCard = (price: number, miles: number, isTotal = true) => {
    const card = document.createElement('div');
    card.setAttribute('data-testid', 'hotel-card-pricing');
    card.innerHTML = `
      <div data-testid="pricing-text">${isTotal ? 'Total (2 nights)' : 'per night'}</div>
      <div data-testid="earn-price">$${price}</div>
      <div data-testid="tier-earn-rewards">Earn ${miles.toLocaleString()} miles per stay</div>
    `;
    return card;
  };

  it('injects summary banner and processes initial cards on mount', async () => {
    // Card 1: 2,000 miles / $200 = 10.0 miles/$
    // Card 2: 6,000 miles / $300 = 20.0 miles/$ (max)
    container.appendChild(createHotelCard(200, 2000));
    container.appendChild(createHotelCard(300, 6000));

    cleanupFn = await processSearchPage(container);

    // Wait for RAF batching
    await new Promise((r) => setTimeout(r, 60));

    // 1. Verify summary banner is injected before container
    const summary = document.getElementById('aa-mpd-search-summary');
    expect(summary).not.toBeNull();
    expect(summary?.style.display).toBe('block');
    expect(summary?.innerHTML).toContain('Best earn rate on this page: <b>20.0 miles/$</b>.');
    expect(summary?.nextElementSibling).toBe(container);

    // 2. Verify both cards received badges
    const badges = container.querySelectorAll('.aa-mpd-badge');
    expect(badges.length).toBe(2);
    expect(badges[0].textContent).toBe(' (10.0\u00A0miles/$)');
    expect(badges[1].textContent).toBe(' (20.0\u00A0miles/$)');
  });

  it('dynamically observes and processes newly appended cards and updates max banner', async () => {
    container.appendChild(createHotelCard(200, 2000)); // 10.0 miles/$
    cleanupFn = await processSearchPage(container);

    await new Promise((r) => setTimeout(r, 60));

    const summary = document.getElementById('aa-mpd-search-summary')!;
    expect(summary.innerHTML).toContain('10.0 miles/$');

    // Simulate user scrolling or loading more: new card with 30.0 miles/$ added
    // 3,000 miles / $100 = 30.0 miles/$
    const newCard = createHotelCard(100, 3000);
    container.appendChild(newCard);

    // Allow MutationObserver and RAF to fire
    await new Promise((r) => setTimeout(r, 80));

    // Verify new card was processed
    const newBadge = newCard.querySelector('.aa-mpd-badge');
    expect(newBadge).not.toBeNull();
    expect(newBadge?.textContent).toBe(' (30.0\u00A0miles/$)');

    // Verify max MPD summary banner updated to new highest rate
    expect(summary.innerHTML).toContain('30.0 miles/$');
  });

  it('cleans up summary banner and observer on teardown', async () => {
    container.appendChild(createHotelCard(200, 2000));
    cleanupFn = await processSearchPage(container);

    await new Promise((r) => setTimeout(r, 60));

    expect(document.getElementById('aa-mpd-search-summary')).not.toBeNull();

    // Execute teardown
    cleanupFn();
    cleanupFn = null;

    // Verify banner was removed from DOM
    expect(document.getElementById('aa-mpd-search-summary')).toBeNull();

    // Appending new card should not re-create banner or process if disconnected
    container.appendChild(createHotelCard(100, 5000));
    await new Promise((r) => setTimeout(r, 60));
    expect(document.getElementById('aa-mpd-search-summary')).toBeNull();
  });

  it('prevents duplicate summary banners if re-mounted', async () => {
    container.appendChild(createHotelCard(200, 2000));

    const cleanup1 = await processSearchPage(container);
    await new Promise((r) => setTimeout(r, 50));

    // Mount again (e.g. fast navigation or route re-entry)
    const cleanup2 = await processSearchPage(container);
    await new Promise((r) => setTimeout(r, 50));

    const summaries = document.querySelectorAll('#aa-mpd-search-summary');
    expect(summaries.length).toBe(1);

    cleanup1();
    cleanup2();
  });

  it('runs against real search-guest.html fixture and correctly populates banner and badges', async () => {
    const fixturePath = path.resolve(__dirname, '../fixtures/search-guest.html');
    const fixtureHtml = fs.readFileSync(fixturePath, 'utf-8');
    const dom = new JSDOM(fixtureHtml);

    document.body.innerHTML = dom.window.document.body.innerHTML;

    const fixtureContainer = document.querySelector('[data-testid="hotel-results-list-container"]');
    expect(fixtureContainer).not.toBeNull();

    const fixtureCleanup = await processSearchPage(fixtureContainer!);
    await new Promise((r) => setTimeout(r, 80));

    const banner = document.getElementById('aa-mpd-search-summary');
    expect(banner).not.toBeNull();
    expect(banner?.style.display).toBe('block');
    expect(banner?.innerHTML).toContain('Best earn rate on this page:');

    // Verify badges injected across fixture cards
    const badges = fixtureContainer!.querySelectorAll('.aa-mpd-badge');
    expect(badges.length).toBeGreaterThan(44);

    fixtureCleanup();
    expect(document.getElementById('aa-mpd-search-summary')).toBeNull();
  });
});
