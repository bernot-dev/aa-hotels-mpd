import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupMpdSort, getItemMpd, MPD_SORT_VALUE, MPD_SORT_STORAGE_KEY, type MpdSortController } from '../src/sort';
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
