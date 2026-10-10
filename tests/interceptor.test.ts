import { describe, it, expect, beforeEach } from "vitest";
import {
  extractHotelRatesFromPayload,
  extractTotalFilteredHotels,
  shouldInspectUrl,
  dispatchInterceptedRates,
  EVENT_NAME,
} from "../src/interceptor";
import {
  hotelMpdRegistry,
  clearHotelMpdRegistry,
  ingestHotelRates,
  getHotelMPD,
} from "../src/registry";

describe("Network Response Interceptor", () => {
  beforeEach(() => {
    clearHotelMpdRegistry();
  });

  describe("extractHotelRatesFromPayload", () => {
    it("returns empty array for invalid or non-object payloads", () => {
      expect(extractHotelRatesFromPayload(null)).toEqual([]);
      expect(extractHotelRatesFromPayload(undefined)).toEqual([]);
      expect(extractHotelRatesFromPayload("string")).toEqual([]);
      expect(extractHotelRatesFromPayload(123)).toEqual([]);
      expect(extractHotelRatesFromPayload({})).toEqual([]);
    });

    it("filters out invalid entries (zero price or zero miles)", () => {
      const payload = {
        data: {
          search: {
            properties: [
              {
                propertyId: "1",
                pricing: { displayPrice: { amount: 0 } },
                loyaltyOfferSummary: { offers: [{ earn: { points: 5000 } }] },
              },
              {
                propertyId: "2",
                pricing: { displayPrice: { amount: 500 } },
                loyaltyOfferSummary: { offers: [{ earn: { points: 0 } }] },
              },
            ],
          },
        },
      };

      const rates = extractHotelRatesFromPayload(payload);
      expect(rates).toHaveLength(0);
    });

    it("keeps highest rate when duplicate hotel IDs appear in payload", () => {
      const payload = {
        data: {
          search: {
            properties: [
              {
                propertyId: "999",
                pricing: { displayPrice: { amount: 1000 } },
                loyaltyOfferSummary: { offers: [{ earn: { points: 5000 } }] },
              },
              {
                propertyId: "999",
                pricing: { displayPrice: { amount: 1000 } },
                loyaltyOfferSummary: { offers: [{ earn: { points: 10000 } }] },
              },
            ],
          },
        },
      };

      const rates = extractHotelRatesFromPayload(payload);
      expect(rates).toHaveLength(1);
      expect(rates[0].baseMiles).toBe(10000);
    });
    it("extracts hotel rates from GraphQL search.properties schema", () => {
      const payload = {
        data: {
          search: {
            properties: [
              {
                propertyId: "99887",
                displayName: "The Grand Hotel",
                pricing: {
                  displayPrice: { amount: 350 },
                  inclusive: { amount: 410 },
                },
                loyaltyOfferSummary: {
                  offers: [
                    {
                      earn: { points: 3500 },
                    },
                  ],
                },
              },
            ],
          },
        },
      };

      const rates = extractHotelRatesFromPayload(payload);
      expect(rates).toHaveLength(1);
      expect(rates[0].hotelId).toBe("99887");
      expect(rates[0].hotelName).toBe("The Grand Hotel");
      expect(rates[0].basePrice).toBe(350);
      expect(rates[0].allInPrice).toBe(410);
      expect(rates[0].price).toBe(410);
      expect(rates[0].baseMiles).toBe(3500);
      expect(rates[0].tieredMiles).toBe(3500);
    });

    it("extracts room rates from GraphQL propertyDetail schema", () => {
      const payload = {
        data: {
          propertyDetail: {
            propertyId: "12345",
            propertyName: "Boutique Resort",
            rooms: [
              {
                roomId: "r1",
                pricing: {
                  totalPrice: { amount: 600 },
                },
                loyaltyOfferSummary: {
                  offers: [
                    {
                      earn: { points: 6000 },
                    },
                  ],
                },
              },
            ],
          },
        },
      };

      const rates = extractHotelRatesFromPayload(payload);
      expect(rates).toHaveLength(1);
      expect(rates[0].hotelId).toBe("12345");
      expect(rates[0].hotelName).toBe("Boutique Resort");
      expect(rates[0].price).toBe(600);
      expect(rates[0].baseMiles).toBe(6000);
    });
  });

  describe("shouldInspectUrl", () => {
    it("returns true for search, property, and GraphQL API endpoints", () => {
      expect(shouldInspectUrl("https://search.aadvantagehotels.com/graphql")).toBe(true);
      expect(shouldInspectUrl("/graphql")).toBe(true);
      expect(shouldInspectUrl("/search?query=las+vegas")).toBe(true);
      expect(shouldInspectUrl("/accom/search")).toBe(true);
      expect(shouldInspectUrl("/accom/property?propertyId=123")).toBe(true);
    });

    it("strictly excludes sensitive checkout, booking, and payment pages", () => {
      expect(shouldInspectUrl("https://search.aadvantagehotels.com/checkout/step1")).toBe(false);
      expect(shouldInspectUrl("https://search.aadvantagehotels.com/accom/checkout")).toBe(false);
      expect(shouldInspectUrl("https://search.aadvantagehotels.com/book/reservation")).toBe(false);
      expect(shouldInspectUrl("https://search.aadvantagehotels.com/booking/finalize")).toBe(false);
      expect(shouldInspectUrl("https://search.aadvantagehotels.com/payment/card")).toBe(false);
    });

    it("returns false for non-hotel tracking/analytics endpoints", () => {
      expect(shouldInspectUrl("https://www.google-analytics.com/collect")).toBe(false);
      expect(shouldInspectUrl("https://static.cloudflareinsights.com/beacon.min.js")).toBe(false);
    });
  });

  describe("extractTotalFilteredHotels", () => {
    it("extracts totalFilteredHotels from Agoda citySearch GraphQL payload", () => {
      const payload = {
        data: {
          citySearch: {
            searchResult: {
              searchInfo: {
                totalFilteredHotels: 64,
              },
            },
          },
        },
      };
      expect(extractTotalFilteredHotels(payload)).toBe(64);
    });

    it("extracts totalFilteredHotels for larger multi-page search like Miami (690 results)", () => {
      const payload = {
        data: {
          citySearch: {
            searchResult: {
              searchInfo: {
                totalFilteredHotels: 690,
              },
            },
          },
        },
      };
      expect(extractTotalFilteredHotels(payload)).toBe(690);
    });

    it("falls back to alternative totalProperties and top-level fields", () => {
      expect(extractTotalFilteredHotels({ totalFilteredHotels: 120 })).toBe(120);
      expect(extractTotalFilteredHotels({ totalProperties: 45 })).toBe(45);
      expect(
        extractTotalFilteredHotels({
          data: {
            areaSearch: {
              totalProperties: 88,
            },
          },
        })
      ).toBe(88);
    });

    it("returns null for non-object or missing search counts", () => {
      expect(extractTotalFilteredHotels(null)).toBeNull();
      expect(extractTotalFilteredHotels({})).toBeNull();
      expect(extractTotalFilteredHotels("string")).toBeNull();
    });
  });

  describe("dispatchInterceptedRates", () => {
    it("dispatches CustomEvent with rates detail on window", () => {
      let receivedDetail: any = null;
      const listener = (e: Event) => {
        receivedDetail = (e as CustomEvent).detail;
      };
      window.addEventListener(EVENT_NAME, listener);

      const rates = [
        { hotelId: "123", price: 100, baseMiles: 1000, tieredMiles: 1500 },
      ];
      dispatchInterceptedRates(rates);

      expect(receivedDetail).toEqual({ hotels: rates, totalHotels: undefined });
      window.removeEventListener(EVENT_NAME, listener);
    });

    it("dispatches totalHotels count and persists to sessionStorage", () => {
      let receivedDetail: any = null;
      const listener = (e: Event) => {
        receivedDetail = (e as CustomEvent).detail;
      };
      window.addEventListener(EVENT_NAME, listener);

      const rates = [
        { hotelId: "123", price: 100, baseMiles: 1000, tieredMiles: 1500 },
      ];
      dispatchInterceptedRates(rates, 64);

      expect(receivedDetail).toEqual({ hotels: rates, totalHotels: 64 });
      expect(sessionStorage.getItem("aa_hotels_latest_total")).toBe("64");
      window.removeEventListener(EVENT_NAME, listener);
    });
  });

  describe("ingestHotelRates", () => {
    it("registers rates for the selected earning level", () => {
      const rates = [
        { hotelId: "1001", price: 500, baseMiles: 2500, tieredMiles: 5000 },
        { hotelId: "1002", price: 500, baseMiles: 2500, tieredMiles: 5000 },
      ];

      // Default: credit cardmember with status -> 5000 / 500 = 10.0 MPD
      ingestHotelRates([rates[0]] as any);
      expect(getHotelMPD("1001")).toBeCloseTo(10.0);

      // AAdvantage member -> 2500 / 500 = 5.0 MPD
      ingestHotelRates([rates[1]] as any, "member");
      expect(getHotelMPD("1002")).toBeCloseTo(5.0);
    });
  });
});
