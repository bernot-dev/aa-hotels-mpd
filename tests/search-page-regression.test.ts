import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { processSearchPage, setupSearchExpansion } from '../src/search';
import { clearHotelMpdRegistry } from '../src/registry';

interface MockChrome {
  storage?: {
    sync?: {
      get?: (keys: unknown) => Promise<Record<string, unknown>>;
    };
  };
}

const getGlobalChrome = (): MockChrome | undefined =>
  (globalThis as unknown as { chrome?: MockChrome }).chrome;

const setGlobalChrome = (mock: MockChrome | undefined): void => {
  (globalThis as unknown as { chrome?: MockChrome }).chrome = mock;
};

describe('Search Page Presentation Regression Tests', () => {
  let container: HTMLDivElement;
  let wrapper: HTMLDivElement;
  let cleanupFn: (() => void) | null = null;

  beforeEach(() => {
    clearHotelMpdRegistry();
    wrapper = document.createElement('div');
    container = document.createElement('div');
    container.id = 'searchPageRightColumn';
    container.setAttribute('data-selenium', 'pagination-panel');
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
    card.className = 'PropertyCardItem';
    card.setAttribute('data-selenium', 'hotel-item');
    card.innerHTML = `
      <div data-selenium="hotel-currency" class="PropertyCardPrice__Currency">${isTotal ? 'Total (2 nights)' : 'per night'}</div>
      <div data-selenium="display-price" class="PropertyCardPrice__Value">$${price}</div>
      <div data-selenium="points-max-promo-text">Earn ${miles.toLocaleString()} miles per stay</div>
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
    expect(summary?.innerHTML).toContain('Best earn rate for this location: <b>20.0 miles/$</b>.');
    expect(summary?.nextElementSibling).toBe(container);

    // 2. Verify both cards received badges
    const badges = container.querySelectorAll('.aa-mpd-badge');
    expect(badges.length).toBe(2);
    expect(badges[0].textContent).toContain('10.0 mpd');
    expect(badges[1].textContent).toContain('20.0 mpd');
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
    expect(newBadge?.textContent).toContain('30.0 mpd');

    // Verify max MPD summary banner updated to new highest rate
    expect(summary.innerHTML).toContain('30.0 miles/$');
  });

  it('gracefully handles lazy-loading hotel cards ("Loading best price") and badges them when they resolve', async () => {
    // 1. Initial hotel card with resolved price
    container.appendChild(createHotelCard(200, 2000)); // 10.0 MPD

    // 2. Hotel card in loading state (like Americana Motor Hotel)
    const loadingCard = document.createElement('div');
    loadingCard.className = 'PropertyCardItem';
    loadingCard.setAttribute('data-selenium', 'hotel-item');
    loadingCard.innerHTML = `
      <h3 data-selenium="hotel-name">Americana Motor Hotel</h3>
      <div class="pricing-container">
        <span class="loading-indicator">Loading best price •••••</span>
      </div>
    `;
    container.appendChild(loadingCard);

    cleanupFn = await processSearchPage(container);
    await new Promise((r) => setTimeout(r, 60));

    // Initially, loadingCard has no badges
    expect(loadingCard.querySelector('.aa-mpd-badge')).toBeNull();

    // Summary banner shows 10.0 MPD from the first card
    const summary = document.getElementById('aa-mpd-search-summary')!;
    expect(summary.innerHTML).toContain('10.0 miles/$');

    // 3. The delayed price resolves in the DOM
    const pricingContainer = loadingCard.querySelector('.pricing-container')!;
    pricingContainer.innerHTML = `
      <div data-selenium="hotel-currency" class="PropertyCardPrice__Currency">Total (2 nights)</div>
      <div data-selenium="display-price" class="PropertyCardPrice__Value">$250</div>
      <div data-selenium="points-max-promo-text">Earn 5,000 miles per stay</div>
    `;

    // Allow MutationObserver and RAF to fire
    await new Promise((r) => setTimeout(r, 80));

    // 4. Verify Americana Motor Hotel now received the MPD badge: 5,000 / 250 = 20.0 MPD
    const badge = loadingCard.querySelector('.aa-mpd-badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain('20.0 mpd');

    // 5. Verify the summary banner updated to 20.0 MPD
    expect(summary.innerHTML).toContain('20.0 miles/$');
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

    const fixtureContainer = document.querySelector('#searchPageRightColumn, #contentContainer, [data-selenium="pagination-panel"]');
    expect(fixtureContainer).not.toBeNull();

    const fixtureCleanup = await processSearchPage(fixtureContainer!);
    await new Promise((r) => setTimeout(r, 80));

    const banner = document.getElementById('aa-mpd-search-summary');
    expect(banner).not.toBeNull();
    expect(banner?.style.display).toBe('block');
    expect(banner?.innerHTML).toContain('Best earn rate for this location:');

    // Verify badges injected across fixture cards (1 chip per priced card in property-card-info)
    const badges = fixtureContainer!.querySelectorAll('.aa-mpd-badge');
    expect(badges.length).toBeGreaterThanOrEqual(30);

    fixtureCleanup();
    expect(document.getElementById('aa-mpd-search-summary')).toBeNull();
  }, 15000);

  it('runs against real search-authenticated.html fixture and correctly populates banner and badges', async () => {
    const fixturePath = path.resolve(__dirname, '../fixtures/search-authenticated.html');
    if (!fs.existsSync(fixturePath)) {
      return;
    }
    const fixtureHtml = fs.readFileSync(fixturePath, 'utf-8');
    const dom = new JSDOM(fixtureHtml);

    document.body.innerHTML = dom.window.document.body.innerHTML;

    const fixtureContainer = document.querySelector('#searchPageRightColumn, #contentContainer, [data-selenium="pagination-panel"], [data-testid="hotel-results-list-container"]');
    expect(fixtureContainer).not.toBeNull();

    const fixtureCleanup = await processSearchPage(fixtureContainer!);
    await new Promise((r) => setTimeout(r, 80));

    const banner = document.getElementById('aa-mpd-search-summary');
    expect(banner).not.toBeNull();
    expect(banner?.style.display).toBe('block');
    expect(banner?.innerHTML).toContain('Best earn rate for this location: <b>17.5 miles/$</b>.');

    const badges = fixtureContainer!.querySelectorAll('.aa-mpd-badge');
    expect(badges.length).toBeGreaterThanOrEqual(42);

    fixtureCleanup();
    expect(document.getElementById('aa-mpd-search-summary')).toBeNull();
  }, 15000);
});

describe('Search Result Auto-Expansion Regression Tests', () => {
  let parentContainer: HTMLDivElement;
  let listContainer: HTMLDivElement;
  let cleanupFn: (() => void) | null = null;
  const originalChrome = getGlobalChrome();

  beforeEach(() => {
    clearHotelMpdRegistry();
    parentContainer = document.createElement('div');
    parentContainer.className = 'search-list-parent';
    listContainer = document.createElement('div');
    listContainer.id = 'searchPageRightColumn';
    listContainer.setAttribute('data-selenium', 'pagination-panel');
    parentContainer.appendChild(listContainer);
    document.body.appendChild(parentContainer);
  });

  afterEach(() => {
    if (cleanupFn) {
      cleanupFn();
      cleanupFn = null;
    }
    document.body.innerHTML = '';
    setGlobalChrome(originalChrome);
  });

  const createCard = (price: number, miles: number) => {
    const card = document.createElement('div');
    card.className = 'PropertyCardItem';
    card.setAttribute('data-selenium', 'hotel-item');
    card.innerHTML = `
      <div data-selenium="hotel-currency" class="PropertyCardPrice__Currency">Total (2 nights)</div>
      <div data-selenium="display-price" class="PropertyCardPrice__Value">$${price}</div>
      <div data-selenium="points-max-promo-text">Earn ${miles.toLocaleString()} miles per stay</div>
    `;
    return card;
  };

  it('automatically expands search results across multiple batches until Load more is gone', async () => {
    setGlobalChrome({
      storage: {
        sync: {
          get: vi.fn().mockResolvedValue({
            expandSearchResults: true,
          }),
        },
      },
    });

    listContainer.appendChild(createCard(100, 1000));

    const totalBatches = 5;
    let batchCount = 0;

    const loadMoreButton = document.createElement('button');
    loadMoreButton.id = 'test-load-more';
    loadMoreButton.textContent = 'Load more';
    parentContainer.appendChild(loadMoreButton);

    loadMoreButton.onclick = () => {
      batchCount++;
      const newCard = createCard(100, 1000 + batchCount * 500);
      listContainer.appendChild(newCard);

      if (batchCount >= totalBatches) {
        loadMoreButton.remove();
      }
    };

    cleanupFn = await processSearchPage(listContainer);

    // Allow async expansion loop to click through batches
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 50));
      if (batchCount >= totalBatches && !document.querySelector('#test-load-more')) {
        break;
      }
    }

    await new Promise((r) => setTimeout(r, 60));

    expect(batchCount).toBe(5);
    expect(document.querySelector('#test-load-more')).toBeNull();
    const allCards = document.querySelectorAll('li.PropertyCardItem, [data-selenium="hotel-item"]');
    expect(allCards.length).toBe(1 + totalBatches);

    // Banner should reflect highest batch: (1000 + 5 * 500) = 3500 miles / $100 = 35.0 miles/$
    const summary = document.getElementById('aa-mpd-search-summary');
    expect(summary?.innerHTML).toContain('35.0 miles/$');
  });

  it('never clicks pagination or image carousel "Next" buttons (they replace the current page)', async () => {
    let clickCount = 0;
    const pagination = document.createElement('div');
    pagination.setAttribute('data-selenium', 'pagination-panel');
    const nextBtn = document.createElement('button');
    nextBtn.setAttribute('data-selenium', 'pagination-next-btn');
    nextBtn.textContent = 'Next';
    nextBtn.onclick = () => clickCount++;
    pagination.appendChild(nextBtn);
    parentContainer.appendChild(pagination);

    const carouselBtn = document.createElement('button');
    carouselBtn.setAttribute('aria-label', 'Next property image Hilton Anatole');
    carouselBtn.onclick = () => clickCount++;
    listContainer.appendChild(carouselBtn);

    const filterBtn = document.createElement('button');
    filterBtn.textContent = 'Show 44 more';
    filterBtn.onclick = () => clickCount++;
    parentContainer.appendChild(filterBtn);

    const controller = setupSearchExpansion({
      expandSearchResults: true,
      pollIntervalMs: 20,
      postClickDelayMs: 20,
      waitTimeoutMs: 50,
      maxInitialWaitMs: 200,
    });

    await new Promise((r) => setTimeout(r, 300));
    expect(clickCount).toBe(0);

    controller.teardown();
  });

  it('waits for busy/loading Load more button to become enabled before clicking', async () => {
    let clickCount = 0;
    const button = document.createElement('button');
    button.textContent = 'Load more';
    button.disabled = true;
    button.onclick = () => {
      clickCount++;
    };
    parentContainer.appendChild(button);

    const controller = setupSearchExpansion({
      expandSearchResults: true,
      pollIntervalMs: 40,
      postClickDelayMs: 40,
      waitTimeoutMs: 150,
    });

    await new Promise((r) => setTimeout(r, 100));
    expect(clickCount).toBe(0);

    button.disabled = false;
    await new Promise((r) => setTimeout(r, 100));
    expect(clickCount).toBe(1);

    controller.teardown();
  });

  it('stops expansion if button is clicked repeatedly without new content (safety guard)', async () => {
    let clickCount = 0;
    const button = document.createElement('button');
    button.textContent = 'Load more';
    button.onclick = () => {
      clickCount++;
    };
    parentContainer.appendChild(button);

    const controller = setupSearchExpansion({
      expandSearchResults: true,
      maxConsecutiveNoChange: 3,
      pollIntervalMs: 20,
      postClickDelayMs: 20,
      waitTimeoutMs: 50,
    });

    await new Promise((r) => setTimeout(r, 350));
    expect(clickCount).toBeLessThanOrEqual(4);

    controller.teardown();
  });

  it('aborts active search expansion on teardown and does not make further clicks', async () => {
    let clickCount = 0;
    const button = document.createElement('button');
    button.textContent = 'Load more';
    button.onclick = () => {
      clickCount++;
      listContainer.appendChild(createCard(100, 1000));
    };
    parentContainer.appendChild(button);

    const controller = setupSearchExpansion({
      expandSearchResults: true,
      pollIntervalMs: 40,
      postClickDelayMs: 40,
      waitTimeoutMs: 100,
    });

    await new Promise((r) => setTimeout(r, 120));
    const clicksBefore = clickCount;
    expect(clicksBefore).toBeGreaterThan(0);

    controller.teardown();

    await new Promise((r) => setTimeout(r, 200));
    expect(clickCount).toBe(clicksBefore);
  });
});
