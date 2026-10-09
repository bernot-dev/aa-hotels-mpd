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
    it("reads the destination and stay from an Agoda search URL (numeric city ID, los)", () => {
      const url =
        "https://search.aadvantagehotels.com/search?cid=1951050&checkIn=2026-11-12&rooms=1&adults=2&textToSearch=Dallas+%28TX%29&los=2&city=8683";
      const criteria = extractSearchCriteria(url, null as unknown as Document);
      expect(criteria.location).toBe("Dallas, TX");
      expect(criteria.checkIn).toBe("2026-11-12");
      expect(criteria.checkOut).toBe("2026-11-14");
      expect(criteria.nights).toBe(2);
    });

    it("never records a numeric city ID as the location", () => {
      const criteria = extractSearchCriteria(
        "https://search.aadvantagehotels.com/search?city=8683&checkIn=2026-11-12&checkOut=2026-11-14",
        null as unknown as Document
      );
      expect(criteria.location).not.toBe("8683");
    });

    it("extracts all parameters from full URL", () => {
      const url =
        "https://search.aadvantagehotels.com/search?destination=Dallas%2C%20TX%2C%20USA&checkIn=2026-10-05&checkOut=2026-10-08&rooms=2&adults=3&children=1";
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
          <a data-selenium="hotel-item-link" href="/accom/property?destination=Austin%2C%20TX&checkIn=2026-11-01&checkOut=2026-11-03&rooms=1&adults=2">
            <div class="PropertyCardItem" data-selenium="hotel-item">Card</div>
          </a>
        </div>
      `);

      const criteria = extractSearchCriteria(
        "https://search.aadvantagehotels.com/search",
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
          <input data-selenium="search-destination" id="downshift-0-input" value="Chicago, IL" />
        </div>
      `);
      const criteria = extractSearchCriteria("https://search.aadvantagehotels.com/search", dom.window.document);
      expect(criteria.location).toBe("Unknown Location");
    });

    it("extracts destination from hotel card details links when URL parameter is missing", () => {
      const dom = new JSDOM(`
        <div>
          <a data-selenium="hotel-item-link" href="/accom/property?destination=San%20Diego%2C%20CA&checkIn=2026-10-05&checkOut=2026-10-07">
            <div class="PropertyCardItem" data-selenium="hotel-item">Card</div>
          </a>
        </div>
      `);
      const criteria = extractSearchCriteria("https://search.aadvantagehotels.com/search", dom.window.document);
      expect(criteria.location).toBe("San Diego, CA");
    });

    it("extracts destination from neighborhood filter container on search page when links lack destination", () => {
      const dom = new JSDOM(`
        <div>
          <div data-selenium="neighborhood-filter">
            <label class="chakra-checkbox">
              <span class="chakra-checkbox__label"><p>Dallas City Center</p></span>
            </label>
            <label class="chakra-checkbox">
              <span class="chakra-checkbox__label"><p>Stemmons Corridor</p></span>
            </label>
          </div>
          <a data-selenium="hotel-item-link" href="/accom/property?propertyId=12345&checkIn=2026-10-05&checkOut=2026-10-07">
            <div class="PropertyCardItem" data-selenium="hotel-item">Card</div>
          </a>
        </div>
      `);
      const criteria = extractSearchCriteria("https://search.aadvantagehotels.com/search", dom.window.document);
      expect(criteria.location).toBe("Dallas City Center");
    });

    it("extracts destination from hotel card neighborhood when filter container and links lack destination", () => {
      const dom = new JSDOM(`
        <div>
          <div>
            <h4 data-selenium="area-city-name">Back Bay</h4>
            <a data-selenium="hotel-item-link" href="/accom/property?propertyId=12345&checkIn=2026-10-05&checkOut=2026-10-07">
              <div class="PropertyCardItem" data-selenium="hotel-item">Card</div>
            </a>
          </div>
        </div>
      `);
      const criteria = extractSearchCriteria("https://search.aadvantagehotels.com/search", dom.window.document);
      expect(criteria.location).toBe("Back Bay");
    });

    it("extracts destination from document title when DOM has no neighborhood tags", () => {
      const dom = new JSDOM(`
        <html>
          <head><title>Hotels in Seattle, WA | AAdvantage Hotels</title></head>
          <body>
            <a data-selenium="hotel-item-link" href="/accom/property?propertyId=12345&checkIn=2026-10-05&checkOut=2026-10-07">
              <div class="PropertyCardItem" data-selenium="hotel-item">Card</div>
            </a>
          </body>
        </html>
      `);
      const criteria = extractSearchCriteria("https://search.aadvantagehotels.com/search", dom.window.document);
      expect(criteria.location).toBe("Seattle, WA");
    });

    it("extracts destination from hotel name city suffix pattern when no other location tag exists", () => {
      const dom = new JSDOM(`
        <div>
          <div>
            <h3 data-selenium="hotel-name">Hilton Anatole, Dallas</h3>
            <div class="PropertyCardItem" data-selenium="hotel-item">Card</div>
          </div>
        </div>
      `);
      const criteria = extractSearchCriteria("https://search.aadvantagehotels.com/search", dom.window.document);
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
    it("extracts one rate per priced card in the live search-guest.html, at the selected earning level", () => {
      const fixturePath = path.resolve(__dirname, "../fixtures/search-guest.html");
      const fixtureHtml = fs.readFileSync(fixturePath, "utf-8");
      const dom = new JSDOM(fixtureHtml);
      const doc = dom.window.document;
      const container = doc.querySelector(
        '#searchPageRightColumn, [data-selenium="pagination-panel"], #contentContainer'
      );
      expect(container).not.toBeNull();

      const pricedCards = Array.from(doc.querySelectorAll("li.PropertyCardItem")).filter((c) =>
        c.querySelector('[data-element-name="fpc-room-price"]')
      );
      const milesCaptions = pricedCards.flatMap((c) =>
        Array.from(c.querySelectorAll('[data-testid="upc_caption"]')).filter((e) =>
          /Earn [\d,]+ miles/.test(e.textContent || "")
        )
      );
      expect(pricedCards.length).toBeGreaterThan(0);

      expect(milesCaptions.length).toBeGreaterThan(pricedCards.length);

      const rates = extractRatesFromSearchCards(container!, 2, false);
      expect(rates.length).toBe(pricedCards.length);

      // First rate matches the first priced card's DOM, read independently
      const firstCard = pricedCards[0];
      const price = Number(firstCard.querySelector('[data-element-name="fpc-room-price"]')!.getAttribute("data-fpc-value"));
      const cardMiles = Array.from(firstCard.querySelectorAll('[data-testid="upc_caption"]'))
        .map((e) => e.textContent!.match(/Earn ([\d,]+) miles/)?.[1])
        .filter(Boolean)
        .map((m) => Number(m!.replace(/,/g, "")));
      // Default level is credit cardmember with status: the higher miles line
      const miles = Math.max(...cardMiles);
      expect(extractRatesFromSearchCards(container!, 2, false, "member")[0].miles).toBe(Math.min(...cardMiles));
      const name = firstCard.querySelector('[data-selenium="hotel-name"] h2')!.childNodes[0].textContent!.trim();

      const firstRate = rates[0];
      expect(firstRate.hotelId).toBe(firstCard.getAttribute("data-hotelid"));
      expect(firstRate.hotelName).toBe(name);
      expect(firstRate.hotelName).not.toMatch(/stars? out of/);
      expect(firstRate.location).toMatch(/^[A-Za-z .'-]+, [A-Z]{2}$/);
      expect(firstRate.price).toBe(price);
      expect(firstRate.miles).toBe(miles);
      // "2 nights including taxes and fees" is a total price, not nightly
      expect(firstRate.isTotalPrice).toBe(true);
      expect(firstRate.mpd).toBe(Number((miles / price).toFixed(1)));
    });
  });

  describe("extractRatesFromDetailsCards with details fixture", () => {
    it("extracts room rates from the live details-guest.html", () => {
      const fixturePath = path.resolve(__dirname, "../fixtures/details-guest.html");
      const fixtureHtml = fs.readFileSync(fixturePath, "utf-8");
      const dom = new JSDOM(fixtureHtml);
      const doc = dom.window.document;

      const container = doc.querySelector("#property-room-grid-root");
      expect(container).not.toBeNull();

      const rooms = doc.querySelectorAll('[data-selenium="ChildRoomsList-room"]');
      expect(rooms.length).toBeGreaterThan(0);

      const rates = extractRatesFromDetailsCards(container!, 2, true);
      expect(rates.length).toBeGreaterThanOrEqual(rooms.length);
      expect(rates[0].hotelName).toBe(doc.querySelector('[data-selenium="hotel-header-name"]')!.textContent!.trim());
      expect(rates[0].price).toBe(
        Number(rooms[0].querySelector('[data-element-name="fpc-room-price"]')!.getAttribute("data-fpc-value"))
      );
      expect(rates[0].isTotalPrice).toBe(true);
      expect(rates[0].mpd).toBeGreaterThan(0);
    });

    it("excludes bonus miles offers when includeBonusMiles is false", () => {
      const fixturePath = path.resolve(__dirname, "../fixtures/details-guest.html");
      const fixtureHtml = fs.readFileSync(fixturePath, "utf-8");
      const dom = new JSDOM(fixtureHtml);
      const doc = dom.window.document;

      const container = doc.querySelector("#property-room-grid-root");
      expect(container).not.toBeNull();

      const ratesWithBonus = extractRatesFromDetailsCards(container!, 2, true);
      const ratesWithoutBonus = extractRatesFromDetailsCards(container!, 2, false);

      expect(ratesWithBonus.some((r) => r.isBonus)).toBe(true);
      expect(ratesWithoutBonus.every((r) => !r.isBonus)).toBe(true);
      expect(ratesWithoutBonus.length).toBe(38);
      expect(ratesWithBonus.length).toBe(76);
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
