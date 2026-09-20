import { describe, it, expect, beforeEach } from "vitest";
import {
  extractHotelRatesFromPayload,
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

    it("extracts hotel rates from Rocketmiles searchResult.results schema", () => {
      const payload = {
        searchResult: {
          totalFilteredHotels: 2,
          results: [
            {
              hotel: { id: 12498, name: "Hotel A" },
              economics: {
                total: { amount: 1702 },
                rewardAmount: 14000,
                rewardAmountTiered: 17020,
              },
            },
            {
              hotel: { id: 20286, name: "Hotel B" },
              economics: {
                displayPrice: { amount: 1605 },
                rewardAmount: 8025,
                rewardAmountTiered: 11235,
              },
            },
          ],
        },
      };

      const rates = extractHotelRatesFromPayload(payload);
      expect(rates).toHaveLength(2);

      const hotelA = rates.find((r) => r.hotelId === "12498");
      expect(hotelA).toBeDefined();
      expect(hotelA?.price).toBe(1702);
      expect(hotelA?.baseMiles).toBe(14000);
      expect(hotelA?.tieredMiles).toBe(17020);

      const hotelB = rates.find((r) => r.hotelId === "20286");
      expect(hotelB).toBeDefined();
      expect(hotelB?.price).toBe(1605);
      expect(hotelB?.baseMiles).toBe(8025);
      expect(hotelB?.tieredMiles).toBe(11235);
    });

    it("extracts hotel rates from flat array payload", () => {
      const payload = [
        {
          hotelId: "56885",
          economics: {
            pricePerNight: { amount: 3252 },
            rewardAmount: 13008,
          },
        },
      ];

      const rates = extractHotelRatesFromPayload(payload);
      expect(rates).toHaveLength(1);
      expect(rates[0].hotelId).toBe("56885");
      expect(rates[0].price).toBe(3252);
      expect(rates[0].baseMiles).toBe(13008);
      expect(rates[0].tieredMiles).toBe(13008); // Defaults to baseMiles when tiered is missing
    });

    it("extracts rates from fallback property names", () => {
      const payload = {
        hotels: [
          {
            id: 31637430,
            lowestAveragePrice: { amount: 499 },
            totalRewards: 5988,
          },
        ],
      };

      const rates = extractHotelRatesFromPayload(payload);
      expect(rates).toHaveLength(1);
      expect(rates[0].hotelId).toBe("31637430");
      expect(rates[0].price).toBe(499);
      expect(rates[0].baseMiles).toBe(5988);
    });

    it("filters out invalid entries (zero price or zero miles)", () => {
      const payload = {
        results: [
          {
            hotel: { id: 1 },
            economics: { total: { amount: 0 }, rewardAmount: 5000 },
          },
          {
            hotel: { id: 2 },
            economics: { total: { amount: 500 }, rewardAmount: 0 },
          },
          {
            hotel: { id: 3 },
            economics: { total: { amount: -100 }, rewardAmount: 5000 },
          },
        ],
      };

      const rates = extractHotelRatesFromPayload(payload);
      expect(rates).toHaveLength(0);
    });

    it("keeps highest rate when duplicate hotel IDs appear in payload", () => {
      const payload = {
        results: [
          {
            hotel: { id: 999 },
            economics: { total: { amount: 1000 }, rewardAmount: 5000 }, // 5.0 MPD
          },
          {
            hotel: { id: 999 },
            economics: { total: { amount: 1000 }, rewardAmount: 10000 }, // 10.0 MPD
          },
        ],
      };

      const rates = extractHotelRatesFromPayload(payload);
      expect(rates).toHaveLength(1);
      expect(rates[0].baseMiles).toBe(10000);
    });

    it("extracts enriched hotel data with all-in pricing and canonical location from real Rocket Travel API schema", () => {
      const payload = {
        id: "529476cd-ae38-4b09-bffa-df7ff02156d0",
        checkInDate: "2026-11-16",
        checkOutDate: "2026-11-18",
        placeResult: {
          city: "Flagstaff (AZ)",
          state: "Arizona State",
          country: "United States",
          latitude: 35.198067,
          longitude: -111.651273,
        },
        results: [
          {
            hotel: {
              id: 12498,
              name: "Little America Hotel Flagstaff",
              stars: 4.0,
              rating: 9.5,
              numberOfReviews: 4055,
              address: {
                line1: "2515 East Butler Avenue",
                city: "Flagstaff (AZ)",
                state: { name: "Arizona", code: "AZ" },
                country: { name: "United States" },
                zipcode: "86004",
                latitude: 35.1873,
                longitude: -111.6212,
                neighborhoodName: "Southside Neighborhood",
              },
              mainImage: { url: "https://example.com/hotel.jpg" },
            },
            totalPrice: { amount: 298.0 },
            lowestAveragePrice: { amount: 149.0 },
            grandTotalPublishedPriceInclusive: { amount: 331.94 },
            fees: 80.04,
            rewards: 400,
            roomTypeResultTeaser: { rewards: 4500 },
            refundability: "REFUNDABLE",
          },
        ],
      };

      const rates = extractHotelRatesFromPayload(payload);
      expect(rates).toHaveLength(1);
      const hotel = rates[0];

      expect(hotel.hotelId).toBe("12498");
      expect(hotel.hotelName).toBe("Little America Hotel Flagstaff");
      expect(hotel.basePrice).toBe(298.0);
      expect(hotel.allInPrice).toBe(331.94);
      expect(hotel.nightlyPrice).toBe(149.0);
      expect(hotel.fees).toBe(80.04);
      expect(hotel.baseMiles).toBe(400);
      expect(hotel.tieredMiles).toBe(4500);
      expect(hotel.city).toBe("Flagstaff");
      expect(hotel.state).toBe("AZ");
      expect(hotel.location).toBe("Flagstaff, AZ");
      expect(hotel.neighborhood).toBe("Southside Neighborhood");
      expect(hotel.zipcode).toBe("86004");
      expect(hotel.stars).toBe(4.0);
      expect(hotel.rating).toBe(9.5);
      expect(hotel.reviewCount).toBe(4055);
      expect(hotel.refundable).toBe(true);
      expect(hotel.nights).toBe(2);
      expect(hotel.searchId).toBe("529476cd-ae38-4b09-bffa-df7ff02156d0");
    });
  });

  describe("shouldInspectUrl", () => {
    it("returns true for search and hotel API endpoints", () => {
      expect(shouldInspectUrl("/rest/aadvantage-hotels/search/uuid-123")).toBe(true);
      expect(shouldInspectUrl("https://www.aadvantagehotels.com/rest/aadvantage-hotels/v2/search")).toBe(true);
      expect(shouldInspectUrl("/search?query=las+vegas")).toBe(true);
      expect(shouldInspectUrl("/results")).toBe(true);
      expect(shouldInspectUrl("/hotels/12345/rooms")).toBe(true);
    });

    it("returns false for non-hotel tracking/analytics endpoints", () => {
      expect(shouldInspectUrl("https://www.google-analytics.com/collect")).toBe(false);
      expect(shouldInspectUrl("https://static.cloudflareinsights.com/beacon.min.js")).toBe(false);
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

      expect(receivedDetail).toEqual({ hotels: rates });
      window.removeEventListener(EVENT_NAME, listener);
    });
  });

  describe("ingestHotelRates", () => {
    it("registers rates into hotelMpdRegistry and handles includeBonusMiles", () => {
      const rates = [
        { hotelId: "1001", price: 500, baseMiles: 2500, tieredMiles: 5000 },
      ];

      // With bonus miles OFF -> 2500 / 500 = 5.0 MPD
      ingestHotelRates(rates, false);
      expect(getHotelMPD("1001")).toBeCloseTo(5.0);

      // With bonus miles ON -> 5000 / 500 = 10.0 MPD
      ingestHotelRates(rates, true);
      expect(getHotelMPD("1001")).toBeCloseTo(10.0);
    });
  });
});
