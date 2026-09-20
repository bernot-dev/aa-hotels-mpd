import { describe, it, expect, beforeEach } from "vitest";
import { TopMpdRecord } from "../src/types";
import {
  identifyHotelChain,
  computeValueScore,
  computeCpm,
  deduplicateRecordsByHotel,
  buildLocationHierarchy,
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

  function parseDateMs(dateStr: string | undefined): number {
    if (!dateStr) return 0;
    const trimmed = String(dateStr).trim();
    const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getTime();
    }
    const ms = Date.parse(trimmed);
    return isNaN(ms) ? 0 : ms;
  }

  function filterAndSort(
    records: TopMpdRecord[],
    options: {
      location?: string;
      locations?: string[] | Set<string>;
      chain?: string;
      chains?: string[] | Set<string>;
      dateFrom?: string;
      dateTo?: string;
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
      locations,
      chain = "",
      chains,
      dateFrom = "",
      dateTo = "",
      minRating = 0,
      minStars = 0,
      refundableOnly = false,
      under150 = false,
      sortBy = "mpd",
      deduplicate = false,
    } = options;

    const locSet = locations
      ? new Set(locations)
      : location
      ? new Set([location])
      : new Set<string>();

    const chainSet = chains
      ? new Set(chains)
      : chain
      ? new Set([chain])
      : new Set<string>();

    const fromMs = dateFrom ? parseDateMs(dateFrom) : 0;
    const toMs = dateTo ? parseDateMs(dateTo) : 0;

    const filtered = records.filter((r) => {
      if (locSet.size > 0 && !locSet.has(r.location)) return false;
      const c = r.chain || identifyHotelChain(r.hotelName);
      if (chainSet.size > 0 && !chainSet.has(c)) return false;
      if (fromMs > 0) {
        const checkInMs = parseDateMs(r.checkIn);
        if (checkInMs > 0 && checkInMs < fromMs) return false;
      }
      if (toMs > 0) {
        const checkOutMs = parseDateMs(r.checkOut);
        if (checkOutMs > 0 && checkOutMs > toMs) return false;
      }
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

  it("builds a 2-level hierarchical location tree (State -> Cities)", () => {
    const oregonRecords: TopMpdRecord[] = [
      { id: "101", hotelName: "Courtyard Corvallis", location: "Corvallis, OR", checkIn: "2026-11-10", checkOut: "2026-11-12", nights: 2, rooms: 1, guests: 2, price: 458, miles: 3800, mpd: 8.3, timestamp: "2026-09-20" },
      { id: "102", hotelName: "Comfort Suites Corvallis", location: "Corvallis, OR", checkIn: "2026-11-10", checkOut: "2026-11-12", nights: 2, rooms: 1, guests: 2, price: 300, miles: 3480, mpd: 11.6, timestamp: "2026-09-20" },
      { id: "103", hotelName: "Phoenix Inn Albany", location: "Albany, OR", checkIn: "2026-11-10", checkOut: "2026-11-12", nights: 2, rooms: 1, guests: 2, price: 280, miles: 2800, mpd: 10.0, timestamp: "2026-09-20" },
      ...sampleRecords, // Dallas, TX (4)
    ];

    const hierarchy = buildLocationHierarchy(oregonRecords);
    expect(hierarchy.length).toBe(2); // Oregon and Texas

    const oregon = hierarchy.find((h) => h.stateKey === "OR");
    expect(oregon).toBeDefined();
    expect(oregon?.stateName).toBe("Oregon");
    expect(oregon?.displayLabel).toBe("Oregon (OR)");
    expect(oregon?.totalDeals).toBe(3);
    expect(oregon?.cities.length).toBe(2);

    expect(oregon?.cities[0].cityName).toBe("Albany");
    expect(oregon?.cities[0].cityLocation).toBe("Albany, OR");
    expect(oregon?.cities[0].count).toBe(1);

    expect(oregon?.cities[1].cityName).toBe("Corvallis");
    expect(oregon?.cities[1].cityLocation).toBe("Corvallis, OR");
    expect(oregon?.cities[1].count).toBe(2);

    const texas = hierarchy.find((h) => h.stateKey === "TX");
    expect(texas).toBeDefined();
    expect(texas?.totalDeals).toBe(4);
    expect(texas?.cities[0].cityName).toBe("Dallas");
  });

  it("filters by multi-selected locations (e.g. selecting multiple cities across states)", () => {
    const results = filterAndSort(sampleRecordsWithVegas, {
      locations: ["Dallas, TX", "Las Vegas, NV"],
    });
    expect(results.length).toBe(6);
  });

  it("filters by state selection (selecting Oregon selects all cities in Oregon: Corvallis + Albany)", () => {
    const mixedRecords: TopMpdRecord[] = [
      { id: "101", hotelName: "Courtyard Corvallis", location: "Corvallis, OR", checkIn: "2026-11-10", checkOut: "2026-11-12", nights: 2, rooms: 1, guests: 2, price: 458, miles: 3800, mpd: 8.3, timestamp: "2026-09-20" },
      { id: "102", hotelName: "Phoenix Inn Albany", location: "Albany, OR", checkIn: "2026-11-10", checkOut: "2026-11-12", nights: 2, rooms: 1, guests: 2, price: 280, miles: 2800, mpd: 10.0, timestamp: "2026-09-20" },
      ...sampleRecords, // Dallas, TX (4)
    ];

    const hierarchy = buildLocationHierarchy(mixedRecords);
    const oregon = hierarchy.find((h) => h.stateKey === "OR")!;
    // Selecting Oregon selects all cities in Oregon
    const oregonCities = oregon.cities.map((c) => c.cityLocation);

    const results = filterAndSort(mixedRecords, {
      locations: oregonCities,
    });
    expect(results.length).toBe(2);
    expect(results.map((r) => r.hotelName)).toContain("Courtyard Corvallis");
    expect(results.map((r) => r.hotelName)).toContain("Phoenix Inn Albany");
  });

  it("filters by multi-selected chains (e.g. Marriott + Hilton)", () => {
    const results = filterAndSort(sampleRecords, {
      chains: ["Marriott", "Hilton"],
    });
    expect(results.length).toBe(3); // 2 Marriott, 1 Hilton
    expect(results.every((r) => r.chain === "Marriott" || r.chain === "Hilton")).toBe(true);
  });

  it("filters by date boundaries (Check-in on/after and Check-out on/before)", () => {
    const octDeals = filterAndSort(sampleRecordsWithVegas, {
      dateFrom: "2026-10-01",
      dateTo: "2026-10-02",
    });
    expect(octDeals.length).toBe(4); // Only the Oct 1-2 Dallas records
    expect(octDeals.every((r) => r.location === "Dallas, TX")).toBe(true);

    const novDeals = filterAndSort(sampleRecordsWithVegas, {
      dateFrom: "2026-11-01",
      dateTo: "2026-11-30",
    });
    expect(novDeals.length).toBe(2); // Only the Nov 16-18 Vegas records
    expect(novDeals.every((r) => r.location === "Las Vegas, NV")).toBe(true);

    // Boundary with no upper bound (everything on or after Nov 1)
    const afterNov1 = filterAndSort(sampleRecordsWithVegas, {
      dateFrom: "2026-11-01",
    });
    expect(afterNov1.length).toBe(2);
    expect(afterNov1.every((r) => r.checkIn >= "2026-11-01")).toBe(true);
  });
});
