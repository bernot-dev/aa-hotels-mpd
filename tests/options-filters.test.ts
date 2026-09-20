import { describe, it, expect, beforeEach } from "vitest";
import { TopMpdRecord } from "../src/types";
import {
  identifyHotelChain,
  computeValueScore,
  computeCpm,
  deduplicateRecordsByHotel,
} from "../src/analytics";

describe("Options Dashboard Filtering & Sorting Logic", () => {
  const sampleRecords: TopMpdRecord[] = [
    {
      id: "1",
      hotelName: "Courtyard Dallas Downtown",
      location: "Dallas, TX",
      checkIn: "2026-10-01",
      checkOut: "2026-10-02",
      nights: 1,
      rooms: 1,
      guests: 2,
      price: 180,
      miles: 4500,
      mpd: 25.0,
      timestamp: "2026-09-01T00:00:00.000Z",
      stars: 3,
      rating: 8.5,
      refundable: true,
      chain: "Marriott",
      cpm: 4.0,
      valueScore: 21.3,
    },
    {
      id: "2",
      hotelName: "Motel Cheap",
      location: "Dallas, TX",
      checkIn: "2026-10-01",
      checkOut: "2026-10-02",
      nights: 1,
      rooms: 1,
      guests: 2,
      price: 90,
      miles: 2700,
      mpd: 30.0,
      timestamp: "2026-09-01T00:00:00.000Z",
      stars: 2,
      rating: 6.5,
      refundable: false,
      chain: "Independent / Other",
      cpm: 3.3,
      valueScore: 19.5,
    },
    {
      id: "3",
      hotelName: "Ritz-Carlton Dallas",
      location: "Dallas, TX",
      checkIn: "2026-10-01",
      checkOut: "2026-10-02",
      nights: 1,
      rooms: 1,
      guests: 2,
      price: 500,
      miles: 10000,
      mpd: 20.0,
      timestamp: "2026-09-01T00:00:00.000Z",
      stars: 5,
      rating: 9.4,
      refundable: true,
      chain: "Marriott",
      cpm: 5.0,
      valueScore: 18.8,
    },
    {
      id: "4",
      hotelName: "Hampton Inn Dallas Market Center",
      location: "Dallas, TX",
      checkIn: "2026-10-01",
      checkOut: "2026-10-02",
      nights: 1,
      rooms: 1,
      guests: 2,
      price: 120,
      miles: 3600,
      mpd: 30.0,
      timestamp: "2026-09-01T00:00:00.000Z",
      stars: 3,
      rating: 8.8,
      refundable: true,
      chain: "Hilton",
      cpm: 3.3,
      valueScore: 26.4,
    },
  ];

  const vegasRecords: TopMpdRecord[] = [
    {
      id: "5",
      hotelName: "Horseshoe Las Vegas",
      hotelId: "h-horseshoe",
      location: "Las Vegas, NV",
      checkIn: "2026-11-16",
      checkOut: "2026-11-18",
      nights: 2,
      rooms: 1,
      guests: 2,
      price: 436,
      miles: 15000,
      mpd: 34.4,
      timestamp: "2026-09-01T00:00:00.000Z",
      stars: 4,
      rating: 8.0,
      refundable: true,
      chain: "Independent / Other",
      cpm: 2.9,
      valueScore: 27.5,
    },
    {
      id: "6",
      hotelName: "Horseshoe Las Vegas",
      hotelId: "h-horseshoe",
      location: "Las Vegas, NV",
      checkIn: "2026-11-16",
      checkOut: "2026-11-18",
      nights: 2,
      rooms: 1,
      guests: 2,
      price: 412,
      miles: 14000,
      mpd: 34.0,
      timestamp: "2026-09-01T00:00:00.000Z",
      stars: 4,
      rating: 8.0,
      refundable: true,
      chain: "Independent / Other",
      cpm: 2.9,
      valueScore: 27.2,
    },
  ];

  const sampleRecordsWithVegas = [...sampleRecords, ...vegasRecords];

  function filterAndSort(
    records: TopMpdRecord[],
    options: {
      location?: string;
      chain?: string;
      minRating?: number;
      minStars?: number;
      refundableOnly?: boolean;
      under150?: boolean;
      sortBy?: "mpd" | "value" | "cpm" | "price";
      deduplicate?: boolean;
    }
  ): TopMpdRecord[] {
    const {
      location = "",
      chain = "",
      minRating = 0,
      minStars = 0,
      refundableOnly = false,
      under150 = false,
      sortBy = "mpd",
      deduplicate = false,
    } = options;

    const filtered = records.filter((r) => {
      if (location && r.location !== location) return false;
      const c = r.chain || identifyHotelChain(r.hotelName);
      if (chain && c !== chain) return false;
      if (minRating > 0 && (!r.rating || r.rating < minRating)) return false;
      if (minStars > 0 && (!r.stars || r.stars < minStars)) return false;
      if (refundableOnly && !r.refundable) return false;
      if (under150 && r.price >= 150) return false;
      return true;
    });

    filtered.sort((a, b) => {
      if (sortBy === "value") {
        const valA = a.valueScore ?? computeValueScore(a.mpd, a.rating);
        const valB = b.valueScore ?? computeValueScore(b.mpd, b.rating);
        return valB - valA;
      } else if (sortBy === "cpm") {
        const cpmA = a.cpm ?? computeCpm(a.price, a.miles);
        const cpmB = b.cpm ?? computeCpm(b.price, b.miles);
        if (cpmA <= 0 && cpmB <= 0) return 0;
        if (cpmA <= 0) return 1;
        if (cpmB <= 0) return -1;
        return cpmA - cpmB;
      } else if (sortBy === "price") {
        return a.price - b.price;
      } else {
        return b.mpd - a.mpd;
      }
    });

    return deduplicate ? deduplicateRecordsByHotel(filtered) : filtered;
  }

  it("filters by chain", () => {
    const results = filterAndSort(sampleRecords, { chain: "Marriott" });
    expect(results.length).toBe(2);
    expect(results.every((r) => r.chain === "Marriott")).toBe(true);
  });

  it("filters by min guest rating", () => {
    const results = filterAndSort(sampleRecords, { minRating: 8.5 });
    expect(results.length).toBe(3); // 8.5, 9.4, 8.8
    expect(results.find((r) => r.id === "2")).toBeUndefined();
  });

  it("filters by min stars", () => {
    const results = filterAndSort(sampleRecords, { minStars: 4 });
    expect(results.length).toBe(1);
    expect(results[0].hotelName).toBe("Ritz-Carlton Dallas");
  });

  it("filters by refundable only", () => {
    const results = filterAndSort(sampleRecords, { refundableOnly: true });
    expect(results.length).toBe(3);
    expect(results.find((r) => r.id === "2")).toBeUndefined();
  });

  it("filters by under $150 (Mileage Run radar)", () => {
    const results = filterAndSort(sampleRecords, { under150: true });
    expect(results.length).toBe(2); // $90, $120
    expect(results.map((r) => r.price)).toEqual([90, 120]);
  });

  it("sorts by Sweet Spot (Quality × MPD)", () => {
    const results = filterAndSort(sampleRecords, { sortBy: "value" });
    // Hampton Inn: 26.4
    // Courtyard: 21.3
    // Motel Cheap: 19.5
    // Ritz-Carlton: 18.8
    expect(results[0].hotelName).toBe("Hampton Inn Dallas Market Center");
    expect(results[1].hotelName).toBe("Courtyard Dallas Downtown");
    expect(results[2].hotelName).toBe("Motel Cheap");
    expect(results[3].hotelName).toBe("Ritz-Carlton Dallas");
  });

  it("sorts by lowest CPM (Cost per mile)", () => {
    const results = filterAndSort(sampleRecords, { sortBy: "cpm" });
    // 3.3, 3.3, 4.0, 5.0
    expect(results[0].cpm).toBe(3.3);
    expect(results[1].cpm).toBe(3.3);
    expect(results[2].cpm).toBe(4.0);
    expect(results[3].cpm).toBe(5.0);
  });

  it("sorts by lowest Price", () => {
    const results = filterAndSort(sampleRecords, { sortBy: "price" });
    expect(results.map((r) => r.price)).toEqual([90, 120, 180, 500]);
  });

  it("combines multiple filters (Sweet Spot Finder: 8.0+ rating, 3+ stars, sorted by Sweet Spot)", () => {
    const results = filterAndSort(sampleRecordsWithVegas, {
      minRating: 8.0,
      minStars: 3,
      sortBy: "value",
    });
    expect(results.length).toBe(5);
    expect(results[0].hotelName).toBe("Horseshoe Las Vegas");
    expect(results[1].hotelName).toBe("Horseshoe Las Vegas");
    expect(results[2].hotelName).toBe("Hampton Inn Dallas Market Center");
  });

  it("filters deals by location (City, State)", () => {
    const dallasResults = filterAndSort(sampleRecordsWithVegas, { location: "Dallas, TX" });
    expect(dallasResults.length).toBe(4);
    expect(dallasResults.every((r) => r.location === "Dallas, TX")).toBe(true);

    const vegasResults = filterAndSort(sampleRecordsWithVegas, { location: "Las Vegas, NV" });
    expect(vegasResults.length).toBe(2);
    expect(vegasResults.every((r) => r.location === "Las Vegas, NV")).toBe(true);
  });

  it("deduplicates multiple rates for the same hotel (features each hotel at most once)", () => {
    const results = filterAndSort(sampleRecordsWithVegas, {
      sortBy: "mpd",
      deduplicate: true,
    });
    // Without deduplication, Horseshoe Las Vegas appeared twice (34.4 and 34.0)
    // With deduplication, Horseshoe Las Vegas should only appear once with its highest MPD (34.4)
    const horseshoeEntries = results.filter((r) => r.hotelName === "Horseshoe Las Vegas");
    expect(horseshoeEntries.length).toBe(1);
    expect(horseshoeEntries[0].mpd).toBe(34.4);
    expect(horseshoeEntries[0].price).toBe(436);

    // Total distinct hotels = 5 (Courtyard, Motel Cheap, Ritz-Carlton, Hampton Inn, Horseshoe)
    expect(results.length).toBe(5);
  });
});
