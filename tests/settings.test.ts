import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DEFAULT_EARNING_LEVEL,
  DEFAULT_MAX_SEARCH_PAGES,
  loadPricingSettings,
  loadSearchSettings,
  milesForEarningLevel,
  parseEarningLevel,
} from '../src/settings';
import { getItemMpd } from '../src/sort';

describe('Earning level setting', () => {
  afterEach(() => {
    delete (globalThis as any).chrome;
  });

  it('defaults to credit cardmember with status', async () => {
    expect(DEFAULT_EARNING_LEVEL).toBe('status_cardmember');
    expect(parseEarningLevel(undefined)).toBe('status_cardmember');
    expect(parseEarningLevel('nonsense')).toBe('status_cardmember');
    expect(parseEarningLevel('member')).toBe('member');

    (globalThis as any).chrome = { storage: { sync: { get: vi.fn().mockResolvedValue({}) } } };
    expect(await loadPricingSettings()).toEqual({
      earningLevel: 'status_cardmember',
      includeBonusMiles: false,
      useAllInPricing: true,
    });
  });

  it('is independent of the bonus miles setting', async () => {
    (globalThis as any).chrome = {
      storage: { sync: { get: vi.fn().mockResolvedValue({ earningLevel: 'member', includeBonusMiles: true }) } },
    };
    expect(await loadPricingSettings()).toMatchObject({ earningLevel: 'member', includeBonusMiles: true });
  });

  it('picks member or status miles, falling back when one is missing', () => {
    expect(milesForEarningLevel(400, 5000, 'status_cardmember')).toBe(5000);
    expect(milesForEarningLevel(400, 5000, 'member')).toBe(400);
    expect(milesForEarningLevel(400, 0, 'status_cardmember')).toBe(400);
    expect(milesForEarningLevel(0, 5000, 'member')).toBe(5000);
  });
});

describe('Most miles per dollar sort value', () => {
  it("uses the card's headline rate (selected earning level) over its best badge", () => {
    const item = document.createElement('li');
    item.innerHTML = `<div data-aa-mpd-rate="2"><span class="aa-mpd-badge" data-rate="25.0"></span><span class="aa-mpd-badge" data-rate="2.0"></span></div>`;
    expect(getItemMpd(item)).toBe(2);
    item.querySelector('[data-aa-mpd-rate]')!.removeAttribute('data-aa-mpd-rate');
    expect(getItemMpd(item)).toBe(25);
  });
});

describe('Search settings', () => {
  afterEach(() => {
    delete (globalThis as any).chrome;
  });

  it('defaults to expandSearchResults true and maxSearchPages 5', async () => {
    (globalThis as any).chrome = { storage: { sync: { get: vi.fn().mockResolvedValue({}) } } };
    expect(await loadSearchSettings()).toEqual({
      expandSearchResults: true,
      maxSearchPages: DEFAULT_MAX_SEARCH_PAGES,
    });
  });

  it('loads configured values and clamps maxSearchPages between 1 and 50', async () => {
    (globalThis as any).chrome = {
      storage: {
        sync: {
          get: vi.fn().mockResolvedValue({
            expandSearchResults: false,
            maxSearchPages: 100,
          }),
        },
      },
    };
    expect(await loadSearchSettings()).toEqual({
      expandSearchResults: false,
      maxSearchPages: 50,
    });

    (globalThis as any).chrome = {
      storage: {
        sync: {
          get: vi.fn().mockResolvedValue({
            expandSearchResults: true,
            maxSearchPages: 0,
          }),
        },
      },
    };
    expect(await loadSearchSettings()).toEqual({
      expandSearchResults: true,
      maxSearchPages: DEFAULT_MAX_SEARCH_PAGES,
    });
  });
});
