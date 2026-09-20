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

    it("extracts criteria from card details link when URL destination param is missing", () => {
      const dom = new JSDOM(`
        <div>
          <a href="/details?destination=Austin%2C%20TX&checkIn=2026-11-01&checkOut=2026-11-03&rooms=1&adults=2">
            <div data-testid="hotel-card-pricing">Card</div>
          </a>
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

    it("never reads destination input box under any circumstances", () => {
      const dom = new JSDOM(`
        <div>
          <input data-testid="search-destination" id="downshift-0-input" value="Chicago, IL" />
        </div>
      `);
      const criteria = extractSearchCriteria("https://www.aadvantagehotels.com/search", dom.window.document);
      expect(criteria.location).toBe("Unknown Location");
    });

    it("extracts destination from hotel card details links when URL parameter is missing", () => {
      const dom = new JSDOM(`
        <div>
          <a href="/details?destination=San%20Diego%2C%20CA&checkIn=2026-10-05&checkOut=2026-10-07">
            <div data-testid="hotel-card-pricing">Card</div>
          </a>
        </div>
      `);
      const criteria = extractSearchCriteria("https://www.aadvantagehotels.com/search", dom.window.document);
      expect(criteria.location).toBe("San Diego, CA");
    });

    it("extracts destination from neighborhood filter container on search page when links lack destination", () => {
      const dom = new JSDOM(`
        <div>
          <div data-testid="neighborhood-filter-container">
            <label class="chakra-checkbox">
              <span class="chakra-checkbox__label"><p>Dallas City Center</p></span>
            </label>
            <label class="chakra-checkbox">
              <span class="chakra-checkbox__label"><p>Stemmons Corridor</p></span>
            </label>
          </div>
          <a href="/details?id=12345&checkIn=2026-10-05&checkOut=2026-10-07">
            <div data-testid="hotel-card-pricing">Card</div>
          </a>
        </div>
      `);
      const criteria = extractSearchCriteria("https://www.aadvantagehotels.com/search", dom.window.document);
      expect(criteria.location).toBe("Dallas City Center");
    });

    it("extracts destination from hotel card neighborhood when filter container and links lack destination", () => {
      const dom = new JSDOM(`
        <div>
          <div>
            <h4 data-testid="hotel-neighborhood">Back Bay</h4>
            <a href="/details?id=12345&checkIn=2026-10-05&checkOut=2026-10-07">
              <div data-testid="hotel-card-pricing">Card</div>
            </a>
          </div>
        </div>
      `);
      const criteria = extractSearchCriteria("https://www.aadvantagehotels.com/search", dom.window.document);
      expect(criteria.location).toBe("Back Bay");
    });

    it("extracts destination from document title when DOM has no neighborhood tags", () => {
      const dom = new JSDOM(`
        <html>
          <head><title>Hotels in Seattle, WA | AAdvantage Hotels</title></head>
          <body>
            <a href="/details?id=12345&checkIn=2026-10-05&checkOut=2026-10-07">
              <div data-testid="hotel-card-pricing">Card</div>
            </a>
          </body>
        </html>
      `);
      const criteria = extractSearchCriteria("https://www.aadvantagehotels.com/search", dom.window.document);
      expect(criteria.location).toBe("Seattle, WA");
    });

    it("extracts destination from hotel name city suffix pattern when no other location tag exists", () => {
      const dom = new JSDOM(`
        <div>
          <div>
            <h3 data-testid="hotel-name">Hilton Anatole, Dallas</h3>
            <div data-testid="hotel-card-pricing">Card</div>
          </div>
        </div>
      `);
      const criteria = extractSearchCriteria("https://www.aadvantagehotels.com/search", dom.window.document);
      expect(criteria.location).toBe("Dallas");
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
      expect(firstRate.location).toBe("Dallas, TX, USA");
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

    it("falls back to hotel card neighborhood when details link does not encode destination", () => {
      const dom = new JSDOM(`
        <div>
          <div>
            <h4 data-testid="hotel-neighborhood">French Quarter</h4>
            <h3 data-testid="hotel-name">Bourbon Orleans Hotel</h3>
            <a href="/details?id=9999&checkIn=2026-10-05&checkOut=2026-10-07">
              <div data-testid="hotel-card-pricing">
                <div data-testid="pricing-text">Total</div>
                <div data-testid="earn-price">$300</div>
                <div data-testid="tier-earn-rewards">Earn 6,000 miles</div>
              </div>
            </a>
          </div>
        </div>
      `);

      const rates = extractRatesFromSearchCards(dom.window.document.body, 1, true);
      expect(rates.length).toBe(1);
      expect(rates[0].hotelName).toBe("Bourbon Orleans Hotel");
      expect(rates[0].location).toBe("French Quarter");
      expect(rates[0].mpd).toBe(20);
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
