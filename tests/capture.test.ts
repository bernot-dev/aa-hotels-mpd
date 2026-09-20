import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { extractSearchCriteria } from "../src/capture/criteria";
import {
  extractRatesFromSearchCards,
  extractRatesFromDetailsCards,
} from "../src/capture/rates";
import {
  queueRatesForDispatch,
  resetRateCollector,
} from "../src/capture/collector";
import { SearchCriteria, CapturedRate } from "../src/types";

describe("Rate and Criteria Capture Pipeline", () => {
  beforeEach(() => {
    resetRateCollector();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("extractSearchCriteria", () => {
    it("extracts all parameters from full URL", () => {
      const url =
        "https://www.aadvantagehotels.com/search?destination=Dallas%2C%20TX%2C%20USA&checkIn=2026-10-05&checkOut=2026-10-08&rooms=2&adults=3&children=1";
      const criteria = extractSearchCriteria(url);

      expect(criteria.location).toBe("Dallas, TX, USA");
      expect(criteria.checkIn).toBe("2026-10-05");
      expect(criteria.checkOut).toBe("2026-10-08");
      expect(criteria.nights).toBe(3);
      expect(criteria.rooms).toBe(2);
      expect(criteria.guests).toBe(4); // 3 adults + 1 child
      expect(criteria.timestamp).toBeDefined();
    });

    it("falls back to DOM inputs when URL params are missing", () => {
      const dom = new JSDOM(`
        <div>
          <input data-testid="search-destination" value="Austin, TX" />
          <input id="check-in-date" value="2026-11-01" />
          <input id="check-out-date" value="2026-11-03" />
          <button data-testid="search-rooms-and-guests-button">1 Room, 2 Guests</button>
        </div>
      `);

      const criteria = extractSearchCriteria(
        "https://www.aadvantagehotels.com/search",
        dom.window.document
      );

      expect(criteria.location).toBe("Austin, TX");
      expect(criteria.checkIn).toBe("2026-11-01");
      expect(criteria.checkOut).toBe("2026-11-03");
      expect(criteria.nights).toBe(2);
      expect(criteria.rooms).toBe(1);
      expect(criteria.guests).toBe(2);
    });

    it("provides clean defaults when both URL and DOM are empty", () => {
      const criteria = extractSearchCriteria("");
      expect(criteria.location).toBe("Unknown Location");
      expect(criteria.nights).toBe(1);
      expect(criteria.rooms).toBe(1);
      expect(criteria.guests).toBe(2);
      expect(criteria.checkIn).toBeDefined();
      expect(criteria.checkOut).toBeDefined();
    });
  });

  describe("extractRatesFromSearchCards with search fixture", () => {
    it("extracts all rates with hotel name, price, miles, and MPD from search-guest.html", () => {
      const fixturePath = path.resolve(__dirname, "../fixtures/search-guest.html");
      const fixtureHtml = fs.readFileSync(fixturePath, "utf-8");
      const dom = new JSDOM(fixtureHtml);
      const container = dom.window.document.querySelector(
        '[data-testid="hotel-results-list-container"]'
      );
      expect(container).not.toBeNull();

      const rates = extractRatesFromSearchCards(container!, 2, true);
      expect(rates.length).toBeGreaterThanOrEqual(44);

      // Check first hotel card
      const firstRate = rates[0];
      expect(firstRate.hotelName).toBe("Hilton Anatole, Dallas");
      expect(firstRate.hotelId).toBe("2687");
      expect(firstRate.price).toBe(557);
      expect(firstRate.miles).toBe(300);
      expect(firstRate.mpd).toBe(0.5);
      expect(firstRate.isTotalPrice).toBe(true);
    });

    it("filters boost/bonus tags when includeBonusMiles is false", () => {
      const dom = new JSDOM(`
        <div>
          <div data-testid="hotel-card-pricing">
            <div data-testid="hotel-name">Normal Hotel</div>
            <div data-testid="pricing-text">Total</div>
            <div data-testid="earn-price">$200</div>
            <div data-testid="tier-earn-rewards">Earn 2,000 miles</div>
          </div>
          <div data-testid="hotel-card-pricing">
            <div data-testid="hotel-name">Bonus Hotel</div>
            <div data-testid="boost-tag-container">Bonus Offer</div>
            <div data-testid="pricing-text">Total</div>
            <div data-testid="earn-price">$200</div>
            <div data-testid="tier-earn-rewards">Earn 6,000 miles</div>
          </div>
        </div>
      `);

      const allRates = extractRatesFromSearchCards(dom.window.document.body, 1, true);
      expect(allRates.length).toBe(2);

      const standardOnly = extractRatesFromSearchCards(dom.window.document.body, 1, false);
      expect(standardOnly.length).toBe(1);
      expect(standardOnly[0].hotelName).toBe("Normal Hotel");
    });
  });

  describe("extractRatesFromDetailsCards with details fixture", () => {
    it("extracts room rates from details-guest.html", () => {
      const fixturePath = path.resolve(__dirname, "../fixtures/details-guest.html");
      const fixtureHtml = fs.readFileSync(fixturePath, "utf-8");
      const dom = new JSDOM(fixtureHtml);

      const container = dom.window.document.querySelector(
        'div[data-testid="room-group"]'
      );
      expect(container).not.toBeNull();

      const rates = extractRatesFromDetailsCards(container!, 2, true);
      expect(rates.length).toBeGreaterThan(0);
      expect(rates[0].hotelName).toBe("Element by Marriott Dallas Downtown East");
      expect(rates[0].price).toBe(496);
      expect(rates[0].mpd).toBeGreaterThan(0);
    });
  });

  describe("Collector Deduplication & Batch Dispatch", () => {
    it("deduplicates identical rates and flushes after debounce window", () => {
      const mockSendMessage = vi.fn().mockResolvedValue({ success: true });
      (globalThis as any).chrome = {
        runtime: {
          sendMessage: mockSendMessage,
        },
      };

      const criteria: SearchCriteria = {
        location: "Dallas",
        checkIn: "2026-10-05",
        checkOut: "2026-10-07",
        nights: 2,
        rooms: 1,
        guests: 2,
        timestamp: "2026-10-01T00:00:00.000Z",
        url: "https://aadvantagehotels.com",
      };

      const rate1: CapturedRate = {
        hotelName: "Hotel A",
        price: 100,
        miles: 2000,
        mpd: 20,
        isTotalPrice: true,
        isBonus: false,
      };

      // Queue rate 1
      queueRatesForDispatch(criteria, [rate1]);
      // Queue identical rate 1 again (should be deduplicated)
      queueRatesForDispatch(criteria, [rate1]);

      expect(mockSendMessage).not.toHaveBeenCalled();

      // Fast-forward debounce timer (250ms)
      vi.advanceTimersByTime(300);

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const callArg = mockSendMessage.mock.calls[0][0];
      expect(callArg.type).toBe("RECORD_RATES");
      expect(callArg.rates.length).toBe(1);
      expect(callArg.rates[0].hotelName).toBe("Hotel A");
    });
  });
});
