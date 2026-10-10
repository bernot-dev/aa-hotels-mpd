import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import {
  setupMpdSort,
  getItemMpd,
  MPD_SORT_LABEL,
  MPD_SORT_STORAGE_KEY,
  SORT_BUTTON_ID,
  SORT_CONTAINER_ID,
  SORT_BAR_CONTAINER_SELECTOR,
  SORT_BAR_STYLE_ID,
  type MpdSortController,
} from '../src/sort';
import { processSearchPage } from '../src/search';

describe('getItemMpd', () => {
  it('returns headline rate or best badge rate, or -1 for unrated items', () => {
    const el = document.createElement('div');
    el.innerHTML = '<span class="aa-mpd-badge" data-rate="4.5"></span><span class="aa-mpd-badge" data-rate="11.2"></span>';
    expect(getItemMpd(el)).toBe(11.2);

    const cardWithDataset = document.createElement('div');
    cardWithDataset.dataset.aaMpdRate = '15.0';
    expect(getItemMpd(cardWithDataset)).toBe(15.0);

    const unrated = document.createElement('div');
    expect(getItemMpd(unrated)).toBe(-1);
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
