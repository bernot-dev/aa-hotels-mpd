import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import {
  setupMpdSort,
  getItemMpd,
  MPD_SORT_VALUE,
  MPD_SORT_LABEL,
  MPD_SORT_STORAGE_KEY,
  SORT_BUTTON_ID,
  SORT_CONTAINER_ID,
  SORT_BAR_CONTAINER_SELECTOR,
  SORT_BAR_STYLE_ID,
  type MpdSortController,
} from '../src/sort';
import { processSearchPage } from '../src/search';

const SITE_OPTIONS = ['featured', 'priceLowest', 'priceHighest', 'ratedHighest', 'milesHighest', 'distanceLowest'];

describe('Most miles per dollar sort', () => {
  let list: HTMLDivElement;
  let select: HTMLSelectElement;
  let siteOnChange: ReturnType<typeof vi.fn>;
  let controller: MpdSortController | null = null;

  const addHotel = (id: string, rates: number[]) => {
    const card = document.createElement('a');
    card.setAttribute('data-testid', `hotel-card-${id}`);
    card.innerHTML = rates
      .map((rate) => `<div data-testid="tier-earn-rewards">Earn<span class="aa-mpd-badge" data-rate="${rate.toFixed(1)}"></span></div>`)
      .join('');
    list.appendChild(card);
    return card;
  };

  const orderOf = (id: string) => (document.querySelector(`[data-testid="hotel-card-${id}"]`) as HTMLElement).style.order;

  const visualOrder = () =>
    Array.from(list.children)
      .map((el) => ({ id: el.getAttribute('data-testid')!.replace('hotel-card-', ''), order: Number((el as HTMLElement).style.order || 0) }))
      .sort((a, b) => a.order - b.order)
      .map((x) => x.id);

  const choose = (value: string) => {
    select.value = value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = `
      <div id="root">
        <div data-testid="sort-by-container">
          <div class="chakra-select__wrapper">
            <select id="sort-by-dropdown" aria-label="Sort by">
              ${SITE_OPTIONS.map((v) => `<option value="${v}">${v}</option>`).join('')}
            </select>
          </div>
        </div>
        <div data-testid="hotel-results-list-container"><div class="stack" style="display:flex;flex-direction:column"></div></div>
      </div>`;
    list = document.querySelector('.stack') as HTMLDivElement;
    select = document.getElementById('sort-by-dropdown') as HTMLSelectElement;
    // Stand-in for React's delegated listener on its root container
    siteOnChange = vi.fn();
    document.getElementById('root')!.addEventListener('change', siteOnChange);

    addHotel('1', [3.1]);
    addHotel('2', [9.4, 12.0]);
    addHotel('3', []);
    addHotel('4', [7.5]);
  });

  afterEach(() => {
    controller?.teardown();
    controller = null;
    vi.useRealTimers();
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('adds the option once, after the site options', () => {
    controller = setupMpdSort();
    controller.apply();
    controller.apply();

    const options = Array.from(select.options);
    expect(options.filter((o) => o.value === MPD_SORT_VALUE)).toHaveLength(1);
    expect(options.at(-1)!.value).toBe(MPD_SORT_VALUE);
    expect(options.at(-1)!.textContent).toContain('Most miles per dollar');
  });

  it('re-adds the option if the select is re-rendered without it', () => {
    controller = setupMpdSort();
    controller.apply();
    select.querySelector(`option[value="${MPD_SORT_VALUE}"]`)!.remove();
    controller.apply();
    expect(select.querySelector(`option[value="${MPD_SORT_VALUE}"]`)).not.toBeNull();
  });

  it('does not reorder anything until the option is chosen', () => {
    controller = setupMpdSort();
    controller.apply();
    expect(['1', '2', '3', '4'].map(orderOf)).toEqual(['', '', '', '']);
  });

  it('orders hotels by best MPD descending, with unrated hotels last, and hides the change from the site', () => {
    controller = setupMpdSort();
    controller.apply();
    choose(MPD_SORT_VALUE);

    expect(visualOrder()).toEqual(['2', '4', '1', '3']);
    expect(siteOnChange).not.toHaveBeenCalled();
    expect(localStorage.getItem(MPD_SORT_STORAGE_KEY)).toBe('1');
    expect(list.hasAttribute('data-aa-mpd-sorted')).toBe(true);
  });

  it('keeps original order for ties', () => {
    addHotel('5', [7.5]);
    controller = setupMpdSort();
    controller.apply();
    choose(MPD_SORT_VALUE);
    expect(visualOrder()).toEqual(['2', '4', '5', '1', '3']);
  });

  it('places hotels loaded later in the right position', () => {
    controller = setupMpdSort();
    controller.apply();
    choose(MPD_SORT_VALUE);

    addHotel('6', [10.2]);
    controller.apply();
    expect(visualOrder()).toEqual(['2', '6', '4', '1', '3']);
  });

  it('reapplies the persisted preference on a new page load and keeps showing the option', () => {
    localStorage.setItem(MPD_SORT_STORAGE_KEY, '1');
    controller = setupMpdSort();
    controller.apply();

    expect(select.value).toBe(MPD_SORT_VALUE);
    expect(visualOrder()).toEqual(['2', '4', '1', '3']);
  });

  it('restores the option in the select if React resets the value', () => {
    vi.useFakeTimers();
    controller = setupMpdSort();
    controller.apply();
    choose(MPD_SORT_VALUE);

    select.value = 'featured'; // React re-render restoring its controlled value
    vi.advanceTimersByTime(600);
    expect(select.value).toBe(MPD_SORT_VALUE);
  });

  it('picking a site option clears the preference and ordering and lets the site handle it', () => {
    controller = setupMpdSort();
    controller.apply();
    choose(MPD_SORT_VALUE);
    choose('priceLowest');

    expect(siteOnChange).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(MPD_SORT_STORAGE_KEY)).toBeNull();
    expect(['1', '2', '3', '4'].map(orderOf)).toEqual(['', '', '', '']);
    expect(list.hasAttribute('data-aa-mpd-sorted')).toBe(false);

    controller.apply();
    expect(select.value).toBe('priceLowest');
  });

  it('teardown removes the option and ordering but keeps the preference', () => {
    controller = setupMpdSort();
    controller.apply();
    choose(MPD_SORT_VALUE);
    controller.teardown();
    controller = null;

    expect(select.querySelector(`option[value="${MPD_SORT_VALUE}"]`)).toBeNull();
    expect(['1', '2', '3', '4'].map(orderOf)).toEqual(['', '', '', '']);
    expect(document.getElementById('aa-mpd-sort-style')).toBeNull();
    expect(localStorage.getItem(MPD_SORT_STORAGE_KEY)).toBe('1');
  });

  it('ignores apply() calls that arrive after teardown', () => {
    vi.useFakeTimers();
    localStorage.setItem(MPD_SORT_STORAGE_KEY, '1');
    const stale = setupMpdSort();
    stale.apply();
    stale.teardown();

    // A badge update scheduled before teardown lands afterwards
    stale.apply();
    select.value = 'ratedHighest';
    vi.advanceTimersByTime(2000);

    expect(select.value).toBe('ratedHighest');
    expect(['1', '2', '3', '4'].map(orderOf)).toEqual(['', '', '', '']);
  });

  it('shows a plain text option when customizable selects are unsupported', () => {
    vi.stubGlobal('CSS', { supports: () => false });
    try {
      controller = setupMpdSort();
      controller.apply();
      const option = select.querySelector(`option[value="${MPD_SORT_VALUE}"]`)!;
      expect(option.textContent).toBe('Most miles per dollar');
      expect(option.querySelector('img')).toBeNull();
      expect(select.querySelector('button')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('puts the extension logo in the option and closed select when customizable selects are supported', () => {
    vi.stubGlobal('CSS', { supports: (prop: string, value: string) => prop === 'appearance' && value === 'base-select' });
    vi.stubGlobal('chrome', { runtime: { getURL: (p: string) => `chrome-extension://abc/${p}` } });
    try {
      controller = setupMpdSort();
      controller.apply();

      const option = select.querySelector(`option[value="${MPD_SORT_VALUE}"]`)!;
      expect(option.textContent!.trim()).toBe('Most miles per dollar');
      expect(option.querySelector('img')!.getAttribute('src')).toBe('chrome-extension://abc/images/icon-48.png');
      expect(select.firstElementChild!.tagName).toBe('BUTTON');
      expect(select.firstElementChild!.querySelector('selectedcontent')).not.toBeNull();
      expect(document.getElementById('aa-mpd-select-style')!.textContent).toContain('base-select');

      controller.teardown();
      controller = null;
      expect(select.querySelector('button')).toBeNull();
      expect(document.getElementById('aa-mpd-select-style')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('getItemMpd returns the best badge rate or -1', () => {
    expect(getItemMpd(document.querySelector('[data-testid="hotel-card-2"]')!)).toBe(12);
    expect(getItemMpd(document.querySelector('[data-testid="hotel-card-3"]')!)).toBe(-1);
  });
});

describe('Most miles per dollar sort on the search page', () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('sorts cards by the MPD badges processSearchPage computes', async () => {
    localStorage.setItem(MPD_SORT_STORAGE_KEY, '1');
    const hotel = (id: string, price: number, miles: number) => `
      <a data-testid="hotel-card-${id}">
        <div data-testid="hotel-card-pricing">
          <div data-testid="pricing-text">Total (2 nights)</div>
          <div data-testid="earn-price">$${price}</div>
          <div data-testid="tier-earn-rewards">Earn ${miles} miles per stay</div>
        </div>
      </a>`;
    document.body.innerHTML = `
      <select id="sort-by-dropdown"><option value="featured">Featured</option></select>
      <div data-testid="hotel-results-list-container"><div class="stack">
        ${hotel('10', 200, 1000)}${hotel('11', 100, 2000)}${hotel('12', 400, 3000)}
      </div></div>`;

    const container = document.querySelector('[data-testid="hotel-results-list-container"]')!;
    cleanup = await processSearchPage(container);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const orders = ['10', '11', '12'].map(
      (id) => (document.querySelector(`[data-testid="hotel-card-${id}"]`) as HTMLElement).style.order
    );
    // MPD: 10 -> 5.0, 11 -> 20.0, 12 -> 7.5
    expect(orders).toEqual(['2', '0', '1']);
    expect((document.getElementById('sort-by-dropdown') as HTMLSelectElement).value).toBe(MPD_SORT_VALUE);
  });
});

describe('Modern sort-bar-container MPD sort', () => {
  let controller: MpdSortController | null = null;

  afterEach(() => {
    controller?.teardown();
    controller = null;
    document.body.innerHTML = '';
    localStorage.clear();
  });

  const setupSortBarDOM = () => {
    document.body.innerHTML = `
      <div id="root">
        <div data-element-name="sort-bar-container" role="region" aria-label="Sort options">
          <div id="sort-bar-group-label"><p>Sort by</p></div>
          <div role="group" aria-labelledby="sort-bar-group-label" class="sort-group">
            <div><button data-element-name="search-sort-recommended" aria-current="true">Best match</button></div>
            <div><button data-element-name="search-sort-guest-rating" aria-current="false">Top reviewed</button></div>
            <div><button data-element-name="search-sort-price" aria-current="false">Lowest price first</button></div>
            <div><button data-element-name="search-sort-points-earned" aria-current="false">Most miles earned</button></div>
          </div>
        </div>
        <ol class="hotel-list-container">
          <li data-hotelid="101" data-aa-mpd-rate="5.0"><div>Hotel A</div></li>
          <li data-hotelid="102" data-aa-mpd-rate="18.5"><div>Hotel B</div></li>
          <li data-hotelid="103" data-aa-mpd-rate="9.2"><div>Hotel C</div></li>
          <li data-hotelid="104"><div>Hotel D (unrated)</div></li>
        </ol>
      </div>
    `;
  };

  it('injects branded MPD sort button with logo and label into sort-bar-container', () => {
    setupSortBarDOM();
    controller = setupMpdSort();
    controller.apply();

    const sortBar = document.querySelector(SORT_BAR_CONTAINER_SELECTOR);
    const btn = document.getElementById(SORT_BUTTON_ID);
    const wrapper = document.getElementById(SORT_CONTAINER_ID);

    expect(sortBar).not.toBeNull();
    expect(btn).not.toBeNull();
    expect(wrapper).not.toBeNull();
    expect(btn?.getAttribute('data-element-name')).toBe('search-sort-mpd');
    expect(btn?.getAttribute('data-aa-mpd')).toBe('true');
    expect(btn?.getAttribute('aria-current')).toBe('false');
    expect(btn?.textContent).toContain(MPD_SORT_LABEL);
    expect(btn?.querySelector('.aa-mpd-sort-logo')).not.toBeNull();
    expect(document.getElementById(SORT_BAR_STYLE_ID)).not.toBeNull();
  });

  it('clicking the MPD button activates descending sort on ol.hotel-list-container and updates aria-current', () => {
    setupSortBarDOM();
    controller = setupMpdSort();
    controller.apply();

    const btn = document.getElementById(SORT_BUTTON_ID)!;
    const sortBar = document.querySelector(SORT_BAR_CONTAINER_SELECTOR)!;
    const list = document.querySelector('ol.hotel-list-container')!;

    // Click MPD button
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(btn.getAttribute('aria-current')).toBe('true');
    expect(sortBar.getAttribute('data-aa-mpd-active')).toBe('true');
    expect(localStorage.getItem(MPD_SORT_STORAGE_KEY)).toBe('1');
    expect(list.getAttribute('data-aa-mpd-sorted')).toBe('true');

    // Sibling native buttons should have aria-current="false"
    const recBtn = document.querySelector('[data-element-name="search-sort-recommended"]');
    expect(recBtn?.getAttribute('aria-current')).toBe('false');

    // Hotel order: 102 (18.5) -> 0, 103 (9.2) -> 1, 101 (5.0) -> 2, 104 (unrated) -> 3
    const hotel101 = document.querySelector('[data-hotelid="101"]') as HTMLElement;
    const hotel102 = document.querySelector('[data-hotelid="102"]') as HTMLElement;
    const hotel103 = document.querySelector('[data-hotelid="103"]') as HTMLElement;
    const hotel104 = document.querySelector('[data-hotelid="104"]') as HTMLElement;

    expect(hotel102.style.order).toBe('0');
    expect(hotel103.style.order).toBe('1');
    expect(hotel101.style.order).toBe('2');
    expect(hotel104.style.order).toBe('3');
  });

  it('clicking a native sort button deactivates MPD sort and clears ordering', () => {
    setupSortBarDOM();
    controller = setupMpdSort();
    controller.apply();

    const btn = document.getElementById(SORT_BUTTON_ID)!;
    const sortBar = document.querySelector(SORT_BAR_CONTAINER_SELECTOR)!;
    const list = document.querySelector('ol.hotel-list-container')!;
    const priceBtn = document.querySelector('[data-element-name="search-sort-price"]')!;

    // Activate MPD sort
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(list.hasAttribute('data-aa-mpd-sorted')).toBe(true);

    // Click native sort button
    priceBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(btn.getAttribute('aria-current')).toBe('false');
    expect(sortBar.hasAttribute('data-aa-mpd-active')).toBe(false);
    expect(localStorage.getItem(MPD_SORT_STORAGE_KEY)).toBeNull();
    expect(list.hasAttribute('data-aa-mpd-sorted')).toBe(false);

    const items = list.querySelectorAll('li');
    items.forEach((item) => expect(item.style.order).toBe(''));
  });

  it('automatically applies MPD sort on mount when preferred in localStorage', () => {
    localStorage.setItem(MPD_SORT_STORAGE_KEY, '1');
    setupSortBarDOM();
    controller = setupMpdSort();
    controller.apply();

    const btn = document.getElementById(SORT_BUTTON_ID)!;
    const sortBar = document.querySelector(SORT_BAR_CONTAINER_SELECTOR)!;
    const list = document.querySelector('ol.hotel-list-container')!;

    expect(btn.getAttribute('aria-current')).toBe('true');
    expect(sortBar.getAttribute('data-aa-mpd-active')).toBe('true');
    expect(list.getAttribute('data-aa-mpd-sorted')).toBe('true');

    const hotel102 = document.querySelector('[data-hotelid="102"]') as HTMLElement;
    expect(hotel102.style.order).toBe('0');
  });

  it('teardown removes injected sort button, wrapper, styles, and active attributes', () => {
    setupSortBarDOM();
    controller = setupMpdSort();
    controller.apply();

    const btn = document.getElementById(SORT_BUTTON_ID)!;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    controller.teardown();
    controller = null;

    expect(document.getElementById(SORT_BUTTON_ID)).toBeNull();
    expect(document.getElementById(SORT_CONTAINER_ID)).toBeNull();
    expect(document.getElementById(SORT_BAR_STYLE_ID)).toBeNull();
    expect(document.querySelector(SORT_BAR_CONTAINER_SELECTOR)?.hasAttribute('data-aa-mpd-active')).toBe(false);
    expect(document.querySelector('ol.hotel-list-container')?.hasAttribute('data-aa-mpd-sorted')).toBe(false);
  });

  it('integrates with real search-guest.html fixture via processSearchPage', async () => {
    const fixturePath = path.resolve(__dirname, '../fixtures/search-guest.html');
    const fixtureHtml = fs.readFileSync(fixturePath, 'utf-8');
    const dom = new JSDOM(fixtureHtml);
    document.body.innerHTML = dom.window.document.body.innerHTML;

    const fixtureContainer = document.querySelector('[data-selenium="pagination-panel"]')!;
    const cleanup = await processSearchPage(fixtureContainer);
    await new Promise((r) => setTimeout(r, 80));

    const sortBar = document.querySelector(SORT_BAR_CONTAINER_SELECTOR);
    expect(sortBar).not.toBeNull();

    const mpdBtn = document.getElementById(SORT_BUTTON_ID);
    expect(mpdBtn).not.toBeNull();
    expect(mpdBtn?.textContent).toContain(MPD_SORT_LABEL);

    // Click MPD button
    mpdBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    const list = document.querySelector('ol.hotel-list-container')!;
    expect(list.getAttribute('data-aa-mpd-sorted')).toBe('true');

    // Check that items have order assigned
    const hotelItems = list.querySelectorAll<HTMLElement>('li.PropertyCardItem[data-hotelid]');
    expect(hotelItems.length).toBeGreaterThan(0);
    const orders = Array.from(hotelItems).map((h) => Number(h.style.order));
    // Verify orders are set
    expect(orders.some((o) => !isNaN(o))).toBe(true);

    cleanup();
    expect(document.getElementById(SORT_BUTTON_ID)).toBeNull();
  }, 15000);
});
