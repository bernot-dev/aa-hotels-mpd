import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getColorForRatio,
  hotelMpdRegistry,
  registerHotelMPD,
  clearHotelMpdRegistry,
  updateMapPins,
  processMapPreviewCards,
} from '../src/map';

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
      pin1.setAttribute('data-selenium', 'map-pin-101');
      pin1.setAttribute('data-hotel-id', '101');
      pin1.textContent = '$200';

      const pin2 = document.createElement('button');
      pin2.setAttribute('data-selenium', 'map-pin-102');
      pin2.setAttribute('data-hotel-id', '102');
      pin2.textContent = '$150';

      const pin3 = document.createElement('button');
      pin3.setAttribute('data-selenium', 'map-pin-103');
      pin3.setAttribute('data-hotel-id', '103');
      pin3.textContent = '$100';

      const pinUnknown = document.createElement('button');
      pinUnknown.setAttribute('data-selenium', 'map-pin-999');
      pinUnknown.setAttribute('data-hotel-id', '999');
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
      pin.setAttribute('data-selenium', 'map-pin-201');
      pin.setAttribute('data-hotel-id', '201');
      pin.textContent = '$150';
      document.body.appendChild(pin);

      registerHotelMPD('201', 8.5);
      updateMapPins(document.body);

      expect(pin.getAttribute('data-aa-mpd')).toBe('8.5');
      // Single pin ratio defaults to 1.0 (green)
      expect(pin.style.backgroundColor).toBe('rgb(21, 128, 61)');
    });
  });

  describe('Property Preview Card in Map View', () => {
    it('populates MPD badge in property preview card and updates corresponding map pin', () => {
      const mapContainer = document.createElement('div');
      mapContainer.setAttribute('data-testid', 'search-results-map');

      // Add pin 301 to map
      const pin = document.createElement('button');
      pin.setAttribute('data-selenium', 'map-pin-301');
      pin.setAttribute('data-hotel-id', '301');
      pin.textContent = '$499';
      mapContainer.appendChild(pin);

      document.body.appendChild(mapContainer);

      // Pin initially has no MPD
      expect(pin.getAttribute('data-aa-mpd')).toBeNull();

      // Simulate user clicking pin 301: preview card mounts inside map view
      const previewCard = document.createElement('div');
      previewCard.className = 'PropertyCardItem';
      previewCard.setAttribute('data-selenium', 'hotel-item');
      previewCard.setAttribute('data-hotel-id', '301');
      previewCard.innerHTML = `
        <div class="preview-card-body">
          <div data-selenium="hotel-name">Masquerade Tower at Rio Hotel & Casino</div>
          <div data-selenium="hotel-currency" class="PropertyCardPrice__Currency">Total (6 nights)</div>
          <div data-selenium="display-price" class="PropertyCardPrice__Value">$499</div>
          <div data-selenium="points-max-promo-text">Earn 4,200 miles per stay</div>
        </div>
      `;
      mapContainer.appendChild(previewCard);

      // Process preview card and update pins
      processMapPreviewCards(mapContainer, 6, false);
      updateMapPins(mapContainer);

      // 1. Verify preview card received MPD badge: 4,200 miles / $499 = 8.4 miles/$
      const badge = previewCard.querySelector('.aa-mpd-badge');
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toContain('8.4 mpd');

      // 2. Verify hotel was registered in hotelMpdRegistry
      expect(hotelMpdRegistry.get('301')).toBeCloseTo(8.416, 2);

      // 3. Verify pin on map was updated with color and attributes
      expect(pin.getAttribute('data-aa-mpd')).toBe('8.4');
      expect(pin.style.backgroundColor).toBe('rgb(21, 128, 61)'); // Single pin ratio = 1.0 (green)
      expect(pin.title).toContain('8.4 miles/$ ($499)');
    });
  });
});
