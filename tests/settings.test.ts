import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DEFAULT_EARNING_LEVEL,
  DEFAULT_MAX_SEARCH_RESULTS,
  clampMaxSearchResults,
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

  const withStorage = (stored: Record<string, unknown>) => {
    (globalThis as any).chrome = { storage: { sync: { get: vi.fn().mockResolvedValue(stored) } } };
  };

  it('defaults to expanding results and considering up to 450 hotels', async () => {
    withStorage({});
    expect(await loadSearchSettings()).toEqual({ expandSearchResults: true, maxSearchResults: 450 });
    expect(DEFAULT_MAX_SEARCH_RESULTS).toBe(450);
  });

  it('loads the configured maximum, in whole 90-hotel pages from 90 to 4500', async () => {
    withStorage({ expandSearchResults: false, maxSearchResults: 900 });
    expect(await loadSearchSettings()).toEqual({ expandSearchResults: false, maxSearchResults: 900 });

    withStorage({ maxSearchResults: 100000 });
    expect((await loadSearchSettings()).maxSearchResults).toBe(4500);
    withStorage({ maxSearchResults: 0 });
    expect((await loadSearchSettings()).maxSearchResults).toBe(DEFAULT_MAX_SEARCH_RESULTS);

    expect(clampMaxSearchResults(500)).toBe(450);
    expect(clampMaxSearchResults(179)).toBe(90);
    expect(clampMaxSearchResults(10)).toBe(90);
  });

  it('converts a page count saved by older versions at 45 hotels per page', async () => {
    withStorage({ maxSearchPages: 10 });
    expect((await loadSearchSettings()).maxSearchResults).toBe(450);
    // A saved maximum wins over a leftover page count
    withStorage({ maxSearchPages: 10, maxSearchResults: 180 });
    expect((await loadSearchSettings()).maxSearchResults).toBe(180);
  });
});
