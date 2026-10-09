import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { deduplicateRecordsByHotel } from '../src/analytics';
import { extractRatesFromSearchCards } from '../src/capture/rates';
import { clearHotelMpdRegistry, ingestHotelRates } from '../src/registry';
import { extractHotelRatesFromPayload } from '../src/interceptor';
import type { TopMpdRecord } from '../src/types';

const record = (overrides: Partial<TopMpdRecord>): TopMpdRecord => ({
  id: Math.random().toString(36),
  mpd: 10,
  hotelName: 'Canvas Hotel Dallas',
  hotelId: '2451130',
  location: 'Dallas, TX',
  checkIn: '2026-11-12',
  checkOut: '2026-11-14',
  nights: 2,
  rooms: 1,
  guests: 2,
  price: 629,
  miles: 8900,
  timestamp: new Date().toISOString(),
  ...overrides,
});

describe('Dashboard hotel details', () => {
  it("fills a hotel's missing photo and ratings from its other records", () => {
    const best = record({ mpd: 14.1 });
    const withDetails = record({
      mpd: 14.0,
      imageUrl: 'https://pix8.agoda.net/hotelImages/2451130/0/a.jpg',
      stars: 4,
      rating: 8.9,
      reviewCount: 120,
    });
    const other = record({ hotelId: '1', hotelName: 'Other Hotel', mpd: 5 });

    const [top, second] = deduplicateRecordsByHotel([best, withDetails, other]);
    expect(top.mpd).toBe(14.1);
    expect(top).toMatchObject({ imageUrl: withDetails.imageUrl, stars: 4, rating: 8.9, reviewCount: 120 });
    expect(second.hotelName).toBe('Other Hotel');
    expect(second.imageUrl).toBeUndefined();
    // Inputs are not mutated
    expect(best.imageUrl).toBeUndefined();
  });
});

describe('Rates read from search cards', () => {
  const fixturesDir = path.resolve(__dirname, '../fixtures');
  const doc = () => new JSDOM(fs.readFileSync(path.join(fixturesDir, 'search-guest.html'), 'utf-8')).window.document;

  beforeEach(() => clearHotelMpdRegistry());

  it("use the card's own photo when there is no API data", () => {
    const rates = extractRatesFromSearchCards(doc().querySelector('#searchPageRightColumn')!, 2, false);
    expect(rates.length).toBeGreaterThan(0);
    rates.forEach((r) => expect(r.imageUrl).toMatch(/^https:\/\/[^/]+\/.+/));
  });

  it('take photo, stars, and rating from the API data when available', () => {
    const searchCall = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'search-graphql-guest.json'), 'utf-8'));
    const apiRates = extractHotelRatesFromPayload(searchCall.response);
    ingestHotelRates(apiRates);

    const rates = extractRatesFromSearchCards(doc().querySelector('#searchPageRightColumn')!, 2, false);
    const matched = rates.filter((r) => apiRates.some((a) => a.hotelId === r.hotelId));
    expect(matched.length).toBeGreaterThan(0);
    matched.forEach((r) => {
      const api = apiRates.find((a) => a.hotelId === r.hotelId)!;
      expect(r).toMatchObject({ imageUrl: api.imageUrl, stars: api.stars, rating: api.rating });
    });
  });
});
