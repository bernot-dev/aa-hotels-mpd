import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  identifyHotelChain,
  computeValueScore,
  computeCpm,
  computeChainStats,
  computeSeasonalityStats,
} from "../src/analytics";
import {
  openDatabase,
  recordRates,
  getDashboardStats,
  clearAllData,
} from "../src/db/db";
import { SearchCriteria, CapturedRate, TopMpdRecord } from "../src/types";

describe("Dashboard Analytics Engine", () => {
  describe("identifyHotelChain", () => {
    it("identifies Marriott portfolio brands", () => {
      expect(identifyHotelChain("Courtyard Dallas Downtown")).toBe("Marriott");
      expect(identifyHotelChain("Fairfield Inn & Suites Austin")).toBe("Marriott");
      expect(identifyHotelChain("Residence Inn New York Manhattan")).toBe("Marriott");
      expect(identifyHotelChain("Sheraton Grand Chicago")).toBe("Marriott");
      expect(identifyHotelChain("Westin St. Francis San Francisco")).toBe("Marriott");
      expect(identifyHotelChain("Aloft Boston Seaport District")).toBe("Marriott");
      expect(identifyHotelChain("The Ritz-Carlton, Kapalua")).toBe("Marriott");
      expect(identifyHotelChain("JW Marriott Phoenix Desert Ridge")).toBe("Marriott");
      expect(identifyHotelChain("SpringHill Suites by Marriott")).toBe("Marriott");
      expect(identifyHotelChain("TownePlace Suites")).toBe("Marriott");
    });

    it("identifies Hilton portfolio brands", () => {
      expect(identifyHotelChain("Hampton Inn & Suites Orlando")).toBe("Hilton");
      expect(identifyHotelChain("Hilton Garden Inn Seattle")).toBe("Hilton");
      expect(identifyHotelChain("DoubleTree by Hilton Hotel Denver")).toBe("Hilton");
      expect(identifyHotelChain("Embassy Suites by Hilton Scottsdale")).toBe("Hilton");
      expect(identifyHotelChain("Homewood Suites by Hilton San Diego")).toBe("Hilton");
      expect(identifyHotelChain("Home2 Suites by Hilton Atlanta")).toBe("Hilton");
      expect(identifyHotelChain("Tru by Hilton Las Vegas")).toBe("Hilton");
      expect(identifyHotelChain("Waldorf Astoria Beverly Hills")).toBe("Hilton");
      expect(identifyHotelChain("Conrad Tokyo")).toBe("Hilton");
    });

    it("identifies IHG portfolio brands", () => {
      expect(identifyHotelChain("Holiday Inn Express & Suites London")).toBe("IHG");
      expect(identifyHotelChain("Crowne Plaza Paris République")).toBe("IHG");
      expect(identifyHotelChain("InterContinental Miami")).toBe("IHG");
      expect(identifyHotelChain("Kimpton Gray Hotel Chicago")).toBe("IHG");
      expect(identifyHotelChain("Hotel Indigo Venice")).toBe("IHG");
      expect(identifyHotelChain("Candlewood Suites Indianapolis")).toBe("IHG");
      expect(identifyHotelChain("Staybridge Suites Austin")).toBe("IHG");
    });

    it("identifies Wyndham portfolio brands", () => {
      expect(identifyHotelChain("Wyndham Grand Clearwater Beach")).toBe("Wyndham");
      expect(identifyHotelChain("Ramada by Wyndham Los Angeles")).toBe("Wyndham");
      expect(identifyHotelChain("Days Inn by Wyndham Phoenix")).toBe("Wyndham");
      expect(identifyHotelChain("Super 8 by Wyndham Rapid City")).toBe("Wyndham");
      expect(identifyHotelChain("La Quinta Inn & Suites Tampa")).toBe("Wyndham");
      expect(identifyHotelChain("Baymont by Wyndham Nashville")).toBe("Wyndham");
      expect(identifyHotelChain("Microtel Inn & Suites by Wyndham")).toBe("Wyndham");
      expect(identifyHotelChain("Wingate by Wyndham Round Rock")).toBe("Wyndham");
    });

    it("identifies Hyatt portfolio brands", () => {
      expect(identifyHotelChain("Hyatt Place Phoenix / Downtown")).toBe("Hyatt");
      expect(identifyHotelChain("Hyatt Regency San Francisco")).toBe("Hyatt");
      expect(identifyHotelChain("Grand Hyatt Washington")).toBe("Hyatt");
      expect(identifyHotelChain("Andaz Maui at Wailea Resort")).toBe("Hyatt");
      expect(identifyHotelChain("Thompson Nashville")).toBe("Hyatt");
      expect(identifyHotelChain("Hyatt House Salt Lake City")).toBe("Hyatt");
    });

    it("identifies Choice Hotels brands", () => {
      expect(identifyHotelChain("Comfort Inn & Suites Flagstaff")).toBe("Choice");
      expect(identifyHotelChain("Comfort Suites Downtown")).toBe("Choice");
      expect(identifyHotelChain("Quality Inn Denver Airport")).toBe("Choice");
      expect(identifyHotelChain("Sleep Inn & Suites Columbus")).toBe("Choice");
      expect(identifyHotelChain("Clarion Hotel & Conference Center")).toBe("Choice");
      expect(identifyHotelChain("Cambria Hotel New York - Chelsea")).toBe("Choice");
    });

    it("identifies Best Western, Sonesta, and Radisson brands", () => {
      expect(identifyHotelChain("Best Western Plus Austin City Hotel")).toBe("Best Western");
      expect(identifyHotelChain("SureStay Plus Hotel by Best Western")).toBe("Best Western");
      expect(identifyHotelChain("Sonesta Simply Suites Silicon Valley")).toBe("Sonesta");
      expect(identifyHotelChain("Sonesta Select Phoenix Camelback")).toBe("Sonesta");
      expect(identifyHotelChain("Radisson Hotel Salt Lake City Downtown")).toBe("Radisson");
      expect(identifyHotelChain("Country Inn & Suites by Radisson")).toBe("Radisson");
    });

    it("returns 'Independent / Other' for unbranded or boutique hotels", () => {
      expect(identifyHotelChain("The Stanley Hotel")).toBe("Independent / Other");
      expect(identifyHotelChain("GreenTree Inn Sedona")).toBe("Independent / Other");
      expect(identifyHotelChain("Grand View Manor Bed & Breakfast")).toBe("Independent / Other");
      expect(identifyHotelChain("")).toBe("Independent / Other");
    });
  });

  describe("computeValueScore", () => {
    it("scales MPD by rating / 10 when rating is present", () => {
      // 30 MPD with 9.0 rating = 30 * 0.9 = 27.0
      expect(computeValueScore(30, 9.0)).toBe(27.0);
      // 20 MPD with 8.4 rating = 20 * 0.84 = 16.8
      expect(computeValueScore(20, 8.4)).toBe(16.8);
      // 15 MPD with 10.0 rating = 15.0
      expect(computeValueScore(15, 10.0)).toBe(15.0);
    });

    it("uses default baseline (0.75) when rating is missing or zero", () => {
      // 20 MPD without rating = 20 * 0.75 = 15.0
      expect(computeValueScore(20)).toBe(15.0);
      expect(computeValueScore(20, 0)).toBe(15.0);
      expect(computeValueScore(20, undefined)).toBe(15.0);
    });

    it("returns 0 for zero or negative MPD", () => {
      expect(computeValueScore(0, 9.0)).toBe(0);
      expect(computeValueScore(-5, 9.0)).toBe(0);
    });
  });

  describe("computeCpm", () => {
    it("calculates cost per mile in cents accurately", () => {
      // $150 for 7,500 miles = (150 / 7500) * 100 = 2.0¢/mile
      expect(computeCpm(150, 7500)).toBe(2.0);
      // $200 for 15,000 miles = (200 / 15000) * 100 = 1.33... -> 1.3¢/mile
      expect(computeCpm(200, 15000)).toBe(1.3);
      // $85 for 2,000 miles = 4.25 -> 4.3¢/mile
      expect(computeCpm(85, 2000)).toBe(4.3);
    });

    it("returns 0 when price or miles are non-positive", () => {
      expect(computeCpm(0, 5000)).toBe(0);
      expect(computeCpm(200, 0)).toBe(0);
      expect(computeCpm(-50, 5000)).toBe(0);
    });
  });

  describe("computeChainStats", () => {
    it("aggregates rates by chain and calculates averages", () => {
      const records: TopMpdRecord[] = [
        {
          id: "1",
          hotelName: "Courtyard Dallas",
          location: "Dallas, TX",
          checkIn: "2026-10-01",
          checkOut: "2026-10-02",
          nights: 1,
          rooms: 1,
          guests: 2,
          price: 150,
          miles: 4500,
          mpd: 30.0,
          timestamp: "2026-09-01T00:00:00.000Z",
          chain: "Marriott",
        },
        {
          id: "2",
          hotelName: "Residence Inn Austin",
          location: "Austin, TX",
          checkIn: "2026-10-01",
          checkOut: "2026-10-02",
          nights: 1,
          rooms: 1,
          guests: 2,
          price: 200,
          miles: 4000,
          mpd: 20.0,
          timestamp: "2026-09-01T00:00:00.000Z",
          chain: "Marriott",
        },
        {
          id: "3",
          hotelName: "Hampton Inn Houston",
          location: "Houston, TX",
          checkIn: "2026-10-01",
          checkOut: "2026-10-02",
          nights: 1,
          rooms: 1,
          guests: 2,
          price: 100,
          miles: 2500,
          mpd: 25.0,
          timestamp: "2026-09-01T00:00:00.000Z",
          chain: "Hilton",
        },
      ];

      const stats = computeChainStats(records);
      expect(stats.length).toBe(2);

      // Marriott avg: (30 + 20) / 2 = 25.0
      // Hilton avg: 25.0
      const marriott = stats.find((s) => s.chain === "Marriott")!;
      expect(marriott).toBeDefined();
      expect(marriott.count).toBe(2);
      expect(marriott.avgMpd).toBe(25.0);
      expect(marriott.bestMpd).toBe(30.0);
      expect(marriott.topHotel).toBe("Courtyard Dallas");
      // Marriott CPM: $150/4500 = 3.3¢, $200/4000 = 5.0¢ -> avg 4.15 -> 4.2¢
      expect(marriott.avgCpm).toBe(4.2);

      const hilton = stats.find((s) => s.chain === "Hilton")!;
      expect(hilton).toBeDefined();
      expect(hilton.count).toBe(1);
      expect(hilton.avgMpd).toBe(25.0);
      expect(hilton.bestMpd).toBe(25.0);
      expect(hilton.topHotel).toBe("Hampton Inn Houston");
    });
  });

  describe("computeSeasonalityStats", () => {
    it("correctly buckets advance booking days and weekday vs weekend check-ins", () => {
      const records: TopMpdRecord[] = [
        // 2 days in advance (2026-09-01 -> 2026-09-03 is Thursday = weekday)
        {
          id: "1",
          hotelName: "Hotel A",
          location: "Dallas, TX",
          checkIn: "2026-09-03",
          checkOut: "2026-09-04",
          nights: 1,
          rooms: 1,
          guests: 2,
          price: 100,
          miles: 2000,
          mpd: 20.0,
          timestamp: "2026-09-01T12:00:00.000Z",
        },
        // 10 days in advance (2026-09-01 -> 2026-09-11 is Friday = weekend)
        {
          id: "2",
          hotelName: "Hotel B",
          location: "Dallas, TX",
          checkIn: "2026-09-11",
          checkOut: "2026-09-12",
          nights: 1,
          rooms: 1,
          guests: 2,
          price: 150,
          miles: 4500,
          mpd: 30.0,
          timestamp: "2026-09-01T12:00:00.000Z",
        },
        // 45 days in advance (2026-09-01 -> 2026-10-16 is Friday = weekend)
        {
          id: "3",
          hotelName: "Hotel C",
          location: "Dallas, TX",
          checkIn: "2026-10-16",
          checkOut: "2026-10-17",
          nights: 1,
          rooms: 1,
          guests: 2,
          price: 120,
          miles: 3000,
          mpd: 25.0,
          timestamp: "2026-09-01T12:00:00.000Z",
        },
      ];

      const seasonality = computeSeasonalityStats(records);

      // Advance Booking Buckets:
      // "Last Minute (0–3d)": Hotel A (20.0)
      const lastMinute = seasonality.bookingWindows.find((b) => b.label.includes("Last Minute"))!;
      expect(lastMinute.count).toBe(1);
      expect(lastMinute.avgMpd).toBe(20.0);

      // "2 Weeks (8–14d)": Hotel B (30.0)
      const twoWeeks = seasonality.bookingWindows.find((b) => b.label.includes("2 Weeks"))!;
      expect(twoWeeks.count).toBe(1);
      expect(twoWeeks.avgMpd).toBe(30.0);

      // "2 Months (31–60d)": Hotel C (25.0)
      const twoMonths = seasonality.bookingWindows.find((b) => b.label.includes("2 Months"))!;
      expect(twoMonths.count).toBe(1);
      expect(twoMonths.avgMpd).toBe(25.0);

      // Weekday vs Weekend Check-In
      // Weekday: Hotel A (Thursday) -> 20.0
      expect(seasonality.weekdayAvgMpd).toBe(20.0);
      // Weekend: Hotel B (Friday 30.0) + Hotel C (Friday 25.0) -> (30 + 25) / 2 = 27.5
      expect(seasonality.weekendAvgMpd).toBe(27.5);
    });
  });

  describe("Integration with recordRates and getDashboardStats", () => {
    beforeEach(async () => {
      await clearAllData();
    });

    const criteria: SearchCriteria = {
      location: "Dallas, TX, USA",
      checkIn: "2026-10-16",
      checkOut: "2026-10-17",
      nights: 1,
      rooms: 1,
      guests: 2,
      timestamp: "2026-09-20T12:00:00.000Z",
      url: "https://www.aadvantagehotels.com/search",
    };

    it("persists enriched attributes into top_mpds and populates chainStats and seasonality", async () => {
      const rates: CapturedRate[] = [
        {
          hotelName: "Courtyard Dallas Downtown",
          hotelId: "h-marriott-1",
          price: 150,
          miles: 4500,
          mpd: 30.0,
          isTotalPrice: true,
          isBonus: false,
          stars: 3.5,
          rating: 8.8,
          reviewCount: 420,
          imageUrl: "https://example.com/courtyard.jpg",
          refundable: true,
        },
        {
          hotelName: "Hampton Inn Dallas Market Center",
          hotelId: "h-hilton-1",
          price: 120,
          miles: 3000,
          mpd: 25.0,
          isTotalPrice: true,
          isBonus: false,
          stars: 3.0,
          rating: 8.2,
          reviewCount: 215,
          refundable: false,
        },
      ];

      await recordRates(criteria, rates);
      const stats = await getDashboardStats();

      expect(stats.topMpds.length).toBe(2);
      const topDeal = stats.topMpds[0];
      expect(topDeal.hotelName).toBe("Courtyard Dallas Downtown");
      expect(topDeal.chain).toBe("Marriott");
      expect(topDeal.stars).toBe(3.5);
      expect(topDeal.rating).toBe(8.8);
      expect(topDeal.reviewCount).toBe(420);
      expect(topDeal.imageUrl).toBe("https://example.com/courtyard.jpg");
      expect(topDeal.refundable).toBe(true);
      expect(topDeal.cpm).toBe(3.3); // (150 / 4500) * 100 = 3.33... -> 3.3
      // valueScore = 30.0 * (8.8 / 10) = 26.4
      expect(topDeal.valueScore).toBe(26.4);

      // Verify chainStats
      expect(stats.chainStats).toBeDefined();
      expect(stats.chainStats!.length).toBe(2);
      expect(stats.chainStats![0].chain).toBe("Marriott");
      expect(stats.chainStats![0].bestMpd).toBe(30.0);

      // Verify seasonality
      expect(stats.seasonality).toBeDefined();
      expect(stats.seasonality!.weekendAvgMpd).toBe(27.5);
    });

    it("backfills chain, cpm, and valueScore for legacy records missing those fields", async () => {
      // Directly inject a legacy-shaped record into IndexedDB top_mpds
      const db = await openDatabase();
      const tx = db.transaction("top_mpds", "readwrite");
      await new Promise<void>((resolve, reject) => {
        const req = tx.objectStore("top_mpds").put({
          id: "legacy-1",
          hotelName: "Holiday Inn Express Dallas",
          location: "Dallas, TX",
          checkIn: "2026-10-10",
          checkOut: "2026-10-11",
          nights: 1,
          rooms: 1,
          guests: 2,
          price: 100,
          miles: 2500,
          mpd: 25.0,
          timestamp: "2026-09-01T12:00:00.000Z",
          // Notice: chain, cpm, valueScore are undefined
        });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });

      const stats = await getDashboardStats();
      expect(stats.topMpds.length).toBe(1);
      const record = stats.topMpds[0];
      expect(record.chain).toBe("IHG");
      expect(record.cpm).toBe(4.0); // (100 / 2500) * 100 = 4.0
      expect(record.valueScore).toBe(18.8); // 25.0 * 0.75 default = 18.75 -> 18.8
      expect(stats.chainStats![0].chain).toBe("IHG");
    });
  });
});
