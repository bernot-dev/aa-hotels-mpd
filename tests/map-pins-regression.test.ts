import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import {
  getColorForRatio,
  hotelMpdRegistry,
  registerHotelMPD,
  clearHotelMpdRegistry,
  updateMapPins,
  processMapPreviewCards,
  setupMapController,
} from '../src/map';
import { processCard } from '../src/cards';

describe('Map Pin Color Scale & Preview MPD Regression Tests', () => {
  beforeEach(() => {
    clearHotelMpdRegistry();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    clearHotelMpdRegistry();
    document.body.innerHTML = '';
  });

  describe('getColorForRatio', () => {
    it('returns crimson red at ratio 0 (worst MPD)', () => {
      expect(getColorForRatio(0)).toBe('rgb(185, 28, 28)');
    });

    it('returns golden amber at ratio 0.5 (median MPD)', () => {
      expect(getColorForRatio(0.5)).toBe('rgb(217, 119, 6)');
    });

    it('returns forest green at ratio 1.0 (best MPD)', () => {
      expect(getColorForRatio(1.0)).toBe('rgb(21, 128, 61)');
    });

    it('clamps values below 0 to red and above 1 to green', () => {
      expect(getColorForRatio(-0.5)).toBe('rgb(185, 28, 28)');
      expect(getColorForRatio(1.5)).toBe('rgb(21, 128, 61)');
    });
  });

  describe('Map Pin Decoration & Normalization', () => {
    it('normalizes colors across visible pins so lowest is red and highest is green', () => {
      const mapContainer = document.createElement('div');
      mapContainer.setAttribute('data-testid', 'search-results-map');

      // Create 3 pins:
      // Pin 1: 5.0 miles/$ (worst)
      // Pin 2: 10.0 miles/$ (middle)
      // Pin 3: 15.0 miles/$ (best)
      const pin1 = document.createElement('button');
      pin1.setAttribute('data-testid', 'hotel-pin-101');
      pin1.textContent = '$200';

      const pin2 = document.createElement('button');
      pin2.setAttribute('data-testid', 'hotel-pin-102');
      pin2.textContent = '$150';

      const pin3 = document.createElement('button');
      pin3.setAttribute('data-testid', 'hotel-pin-103');
      pin3.textContent = '$100';

      const pinUnknown = document.createElement('button');
      pinUnknown.setAttribute('data-testid', 'hotel-pin-999');
      pinUnknown.textContent = '$300';

      mapContainer.appendChild(pin1);
      mapContainer.appendChild(pin2);
      mapContainer.appendChild(pin3);
      mapContainer.appendChild(pinUnknown);
      document.body.appendChild(mapContainer);

      registerHotelMPD('101', 5.0);
      registerHotelMPD('102', 10.0);
      registerHotelMPD('103', 15.0);

      updateMapPins(mapContainer);

      // Pin 1 (worst) must be red
      expect(pin1.style.backgroundColor).toBe('rgb(185, 28, 28)');
      expect(pin1.getAttribute('data-aa-mpd')).toBe('5.0');
      expect(pin1.title).toContain('5.0 miles/$ ($200)');
      expect(pin1.style.color).toBe('rgb(255, 255, 255)');

      // Pin 3 (best) must be green
      expect(pin3.style.backgroundColor).toBe('rgb(21, 128, 61)');
      expect(pin3.getAttribute('data-aa-mpd')).toBe('15.0');
      expect(pin3.title).toContain('15.0 miles/$ ($100)');

      // Pin 2 (middle) must be amber
      expect(pin2.style.backgroundColor).toBe('rgb(217, 119, 6)');
      expect(pin2.getAttribute('data-aa-mpd')).toBe('10.0');

      // Pin without known MPD must remain unstyled
      expect(pinUnknown.getAttribute('data-aa-mpd')).toBeNull();
      expect(pinUnknown.style.backgroundColor).toBe('');
    });

    it('handles single pin gracefully without NaN or crashing', () => {
      const pin = document.createElement('button');
      pin.setAttribute('data-testid', 'hotel-pin-201');
      pin.textContent = '$150';
      document.body.appendChild(pin);

      registerHotelMPD('201', 8.5);
      updateMapPins(document.body);

      expect(pin.getAttribute('data-aa-mpd')).toBe('8.5');
      // Single pin ratio defaults to 1.0 (green)
      expect(pin.style.backgroundColor).toBe('rgb(21, 128, 61)');
    });
  });

  describe('Real Fixture Tests (search-map-authenticated.html & search-authenticated.html)', () => {
    it('correctly decorates real pins in search-map fixture correlated with search list fixture', () => {
      const searchHtmlPath = path.resolve(__dirname, '../fixtures/search-authenticated.html');
      const searchHtml = fs.readFileSync(searchHtmlPath, 'utf-8');
      const searchDom = new JSDOM(searchHtml);

      // Process all cards in search-authenticated.html to populate hotelMpdRegistry
      const searchCards = searchDom.window.document.querySelectorAll('[data-testid="hotel-card-pricing"]');
      expect(searchCards.length).toBe(42);

      searchCards.forEach((card) => {
        processCard(card, 6, false);
      });

      expect(hotelMpdRegistry.size).toBe(42);

      // Load search-map-authenticated.html fixture
      const mapHtmlPath = path.resolve(__dirname, '../fixtures/search-map-authenticated.html');
      const mapHtml = fs.readFileSync(mapHtmlPath, 'utf-8');
      const mapDom = new JSDOM(mapHtml);

      document.body.innerHTML = mapDom.window.document.body.innerHTML;

      const mapContainer = document.querySelector('[data-testid="search-results-map"]');
      expect(mapContainer).not.toBeNull();

      const allPins = document.querySelectorAll('[data-testid^="hotel-pin-"]');
      expect(allPins.length).toBe(69);

      // Run pin decorator
      updateMapPins(mapContainer!);

      const decoratedPins = document.querySelectorAll('button[data-aa-mpd]');
      expect(decoratedPins.length).toBe(25);

      // Lowest MPD in fixture: hotel 465 (15,000 miles / $5,081 = 3.0 miles/$) -> MUST BE RED
      const lowestPin = document.querySelector<HTMLElement>('[data-testid="hotel-pin-465"]');
      expect(lowestPin).not.toBeNull();
      expect(lowestPin?.getAttribute('data-aa-mpd')).toBe('3.0');
      expect(lowestPin?.style.backgroundColor).toBe('rgb(185, 28, 28)');

      // Highest MPD in fixture: hotel 13863 (14,900 miles / $907 = 16.4 miles/$) -> MUST BE GREEN
      const highestPin = document.querySelector<HTMLElement>('[data-testid="hotel-pin-13863"]');
      expect(highestPin).not.toBeNull();
      expect(highestPin?.getAttribute('data-aa-mpd')).toBe('16.4');
      expect(highestPin?.style.backgroundColor).toBe('rgb(21, 128, 61)');
    });
  });

  describe('Property Preview Card in Map View', () => {
    it('populates MPD badge in property preview card and updates corresponding map pin', async () => {
      const mapContainer = document.createElement('div');
      mapContainer.setAttribute('data-testid', 'search-results-map');

      // Add pin 301 to map
      const pin = document.createElement('button');
      pin.setAttribute('data-testid', 'hotel-pin-301');
      pin.textContent = '$499';
      mapContainer.appendChild(pin);

      document.body.appendChild(mapContainer);

      const controller = setupMapController(mapContainer, 6, false);

      // Pin initially has no MPD
      expect(pin.getAttribute('data-aa-mpd')).toBeNull();

      // Simulate user clicking pin 301: preview card mounts inside map view (like in screenshot)
      const previewCard = document.createElement('div');
      previewCard.setAttribute('data-testid', 'hotel-card-301');
      previewCard.innerHTML = `
        <div class="preview-card-body">
          <div data-testid="hotel-name">Masquerade Tower at Rio Hotel & Casino</div>
          <div data-testid="hotel-card-pricing">
            <div data-testid="pricing-text">Total (6 nights)</div>
            <div data-testid="earn-price">$499</div>
            <div data-testid="tier-earn-rewards">Earn 4,200 miles per stay</div>
          </div>
        </div>
      `;
      mapContainer.appendChild(previewCard);

      // Allow MutationObserver and RAF to run
      await new Promise((r) => setTimeout(r, 60));

      // 1. Verify preview card received MPD badge: 4,200 miles / $499 = 8.4 miles/$
      const badge = previewCard.querySelector('.aa-mpd-badge');
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toBe(' (8.4\u00A0miles/$)');

      // 2. Verify hotel was registered in hotelMpdRegistry
      expect(hotelMpdRegistry.get('301')).toBeCloseTo(8.416, 2);

      // 3. Verify pin on map was updated with color and attributes
      expect(pin.getAttribute('data-aa-mpd')).toBe('8.4');
      expect(pin.style.backgroundColor).toBe('rgb(21, 128, 61)'); // Single pin ratio = 1.0 (green)
      expect(pin.title).toContain('8.4 miles/$ ($499)');

      controller.teardown();
    });
  });
});
