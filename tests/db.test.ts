import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  openDatabase,
  recordRates,
  getDashboardStats,
  getExhaustiveQueries,
  getStorageEstimate,
  clearExhaustiveHistory,
  clearAllData,
  formatBytes,
  cleanCorruptedLocations,
  deleteLocationStat,
  deleteTopMpdRecord,
  isValidLocation,
} from "../src/db/db";
import { SearchCriteria, CapturedRate } from "../src/types";

describe("IndexedDB Storage Layer", () => {
  beforeEach(async () => {
    await clearAllData();
  });

  const sampleCriteria: SearchCriteria = {
    location: "Dallas, TX, USA",
    checkIn: "2026-10-05",
    checkOut: "2026-10-07",
    nights: 2,
    rooms: 1,
    guests: 2,
    timestamp: "2026-10-01T12:00:00.000Z",
    url: "https://www.aadvantagehotels.com/search?destination=Dallas",
  };

  const createRate = (
    hotelName: string,
    mpd: number,
    price: number = 200,
    miles: number = 2000
  ): CapturedRate => ({
    hotelName,
    hotelId: "h123",
    price,
    miles,
    mpd,
    isTotalPrice: true,
    isBonus: false,
  });

  it("opens database and creates expected object stores", async () => {
    const db = await openDatabase();
    expect(db.objectStoreNames.contains("top_mpds")).toBe(true);
    expect(db.objectStoreNames.contains("location_stats")).toBe(true);
    expect(db.objectStoreNames.contains("nights_stats")).toBe(true);
    expect(db.objectStoreNames.contains("exhaustive_queries")).toBe(true);
  });

  it("records rates into top_mpds and keeps them sorted descending", async () => {
    const rates: CapturedRate[] = [
      createRate("Hotel Low", 10.5),
      createRate("Hotel High", 35.2),
      createRate("Hotel Mid", 22.0),
    ];

    await recordRates(sampleCriteria, rates, false);

    const stats = await getDashboardStats();
    expect(stats.topMpds.length).toBe(3);
    expect(stats.topMpds[0].hotelName).toBe("Hotel High");
    expect(stats.topMpds[0].mpd).toBe(35.2);
    expect(stats.topMpds[1].hotelName).toBe("Hotel Mid");
    expect(stats.topMpds[1].mpd).toBe(22.0);
    expect(stats.topMpds[2].hotelName).toBe("Hotel Low");
    expect(stats.topMpds[2].mpd).toBe(10.5);
  });

  it("bounds top_mpds to 100 all-time highest rates", async () => {
    // Generate 120 rates with varying MPDs
    const rates: CapturedRate[] = [];
    for (let i = 1; i <= 120; i++) {
      rates.push(createRate(`Hotel ${i}`, i, 100, i * 100));
    }

    await recordRates(sampleCriteria, rates, false);

    const stats = await getDashboardStats();
    expect(stats.topMpds.length).toBe(100);
    // Highest should be 120
    expect(stats.topMpds[0].mpd).toBe(120);
    // 100th item should be 21 (since 1..20 are pruned)
    expect(stats.topMpds[99].mpd).toBe(21);
  });

  it("tracks top and lowest MPD locations accurately", async () => {
    // Record rates for 4 different locations
    await recordRates(
      { ...sampleCriteria, location: "Miami, FL, USA" },
      [createRate("Miami Luxury", 40.0)],
      false
    );
    await recordRates(
      { ...sampleCriteria, location: "Chicago, IL, USA" },
      [createRate("Chicago Inn", 25.0)],
      false
    );
    await recordRates(
      { ...sampleCriteria, location: "Denver, CO, USA" },
      [createRate("Denver Lodge", 15.0)],
      false
    );
    await recordRates(
      { ...sampleCriteria, location: "Seattle, WA, USA" },
      [createRate("Seattle Suites", 5.0)],
      false
    );

    const stats = await getDashboardStats();
    expect(stats.allLocations.length).toBe(4);

    // Top 3 locations with highest MPD
    expect(stats.topLocations.map((l) => l.location)).toEqual([
      "Miami, FL, USA",
      "Chicago, IL, USA",
      "Denver, CO, USA",
    ]);
    expect(stats.topLocations[0].topMpd).toBe(40.0);

    // 3 locations with lowest MPD (lowest MPD locations)
    // Seattle (5), Denver (15), Chicago (25)
    expect(stats.lowestLocations.map((l) => l.location)).toEqual([
      "Seattle, WA, USA",
      "Denver, CO, USA",
      "Chicago, IL, USA",
    ]);
    expect(stats.lowestLocations[0].topMpd).toBe(5.0);
  });

  it("tracks top MPDs by number of nights", async () => {
    // Record 1-night stay with 18.0 MPD
    await recordRates(
      { ...sampleCriteria, nights: 1 },
      [createRate("1-Night Stay", 18.0)],
      false
    );
    // Record 2-night stay with 28.5 MPD
    await recordRates(
      { ...sampleCriteria, nights: 2 },
      [createRate("2-Night Stay", 28.5)],
      false
    );
    // Record another 1-night stay with higher 24.0 MPD
    await recordRates(
      { ...sampleCriteria, nights: 1 },
      [createRate("Better 1-Night Stay", 24.0)],
      false
    );

    const stats = await getDashboardStats();
    expect(stats.nightsStats[1]?.topMpd).toBe(24.0);
    expect(stats.nightsStats[1]?.hotelName).toBe("Better 1-Night Stay");
    expect(stats.nightsStats[2]?.topMpd).toBe(28.5);
    expect(stats.nightsStats[3]).toBeUndefined();
  });

  it("stores exhaustive queries only when keepExhaustive is true", async () => {
    const rates = [createRate("Exhaustive Hotel", 15.0)];

    // Without keepExhaustive
    await recordRates(sampleCriteria, rates, false);
    let queries = await getExhaustiveQueries();
    expect(queries.length).toBe(0);

    // With keepExhaustive
    await recordRates(sampleCriteria, rates, true);
    queries = await getExhaustiveQueries();
    expect(queries.length).toBe(1);
    expect(queries[0].location).toBe("Dallas, TX, USA");
    expect(queries[0].rates.length).toBe(1);
    expect(queries[0].rates[0].hotelName).toBe("Exhaustive Hotel");
  });

  it("computes humanized storage estimate and allows clearing history", async () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1500)).toBe("1.5 KB");
    expect(formatBytes(1500000)).toBe("1.4 MB");

    let estimate = await getStorageEstimate();
    expect(estimate.count).toBe(0);
    expect(estimate.humanized).toBe("0 queries (0 B)");

    // Add 2 exhaustive queries
    await recordRates(sampleCriteria, [createRate("Hotel A", 12)], true);
    await recordRates(sampleCriteria, [createRate("Hotel B", 18)], true);

    estimate = await getStorageEstimate();
    expect(estimate.count).toBe(2);
    expect(estimate.bytes).toBeGreaterThan(0);
    expect(estimate.humanized).toContain("2 queries");

    // Clear history
    await clearExhaustiveHistory();
    estimate = await getStorageEstimate();
    expect(estimate.count).toBe(0);
    expect(estimate.humanized).toBe("0 queries (0 B)");
  });

  it("isValidLocation correctly validates location strings", () => {
    expect(isValidLocation(undefined)).toBe(false);
    expect(isValidLocation(null)).toBe(false);
    expect(isValidLocation("")).toBe(false);
    expect(isValidLocation("  ")).toBe(false);
    expect(isValidLocation("B")).toBe(false);
    expect(isValidLocation("Bo")).toBe(false);
    expect(isValidLocation("Unknown Location")).toBe(false);
    expect(isValidLocation("unknown location")).toBe(false);

    expect(isValidLocation("Boston")).toBe(true);
    expect(isValidLocation("Boston (MA), United States")).toBe(true);
    expect(isValidLocation("Dallas, TX, USA")).toBe(true);
  });

  it("recordRates ignores rates with invalid partial locations", async () => {
    // Attempt to record rates with "B", "Bo", "Unknown Location"
    await recordRates({ ...sampleCriteria, location: "B" }, [createRate("Hotel B", 24.7)], false);
    await recordRates({ ...sampleCriteria, location: "Bo" }, [createRate("Hotel Bo", 24.7)], false);
    await recordRates({ ...sampleCriteria, location: "Unknown Location" }, [createRate("Hotel Unknown", 24.7)], false);

    const stats = await getDashboardStats();
    expect(stats.topMpds.length).toBe(0);
    expect(stats.allLocations.length).toBe(0);
  });

  it("cleanCorruptedLocations purges partials and prefix duplicates sharing the same hotel", async () => {
    const db = await openDatabase();
    // Directly insert corrupted records into LOCATION_STATS and TOP_MPDS
    const tx = db.transaction(["location_stats", "top_mpds"], "readwrite");
    const locStore = tx.objectStore("location_stats");
    const topStore = tx.objectStore("top_mpds");

    const hotel = "La Quinta Inn & Suites by Wyndham Dallas Grand Prairie North";
    const baseRecord = {
      topMpd: 24.7,
      hotelName: hotel,
      checkIn: "2026-10-05",
      checkOut: "2026-10-07",
      nights: 2,
      price: 150,
      miles: 3705,
      timestamp: new Date().toISOString(),
      observationCount: 1,
    };

    // Insert partials
    locStore.put({ ...baseRecord, location: "B" });
    locStore.put({ ...baseRecord, location: "Bo" });
    locStore.put({ ...baseRecord, location: "Boston" });
    locStore.put({ ...baseRecord, location: "Boston (MA), United States" });
    locStore.put({ ...baseRecord, location: "New" });
    locStore.put({ ...baseRecord, location: "New Orlea" });
    locStore.put({ ...baseRecord, location: "New Orleans" });
    locStore.put({ ...baseRecord, location: "San Diego (CA), United States", hotelName: "Best Western" });

    topStore.put({
      id: "b_rec",
      mpd: 24.7,
      hotelName: hotel,
      location: "B",
      checkIn: "2026-10-05",
      checkOut: "2026-10-07",
      nights: 2,
      rooms: 1,
      guests: 2,
      price: 150,
      miles: 3705,
      timestamp: new Date().toISOString(),
    });

    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });

    // Run cleanCorruptedLocations
    const result = await cleanCorruptedLocations(db);
    expect(result.deletedLocations).toContain("B");
    expect(result.deletedLocations).toContain("Bo");
    expect(result.deletedLocations).toContain("Boston");
    expect(result.deletedLocations).toContain("New");
    expect(result.deletedLocations).toContain("New Orlea");

    // "Boston (MA), United States", "New Orleans", and "San Diego (CA), United States" should remain
    const stats = await getDashboardStats();
    const remainingLocs = stats.allLocations.map((l) => l.location);
    expect(remainingLocs).toContain("Boston (MA), United States");
    expect(remainingLocs).toContain("New Orleans");
    expect(remainingLocs).toContain("San Diego (CA), United States");
    expect(remainingLocs).not.toContain("B");
    expect(remainingLocs).not.toContain("Bo");
    expect(remainingLocs).not.toContain("Boston");
    expect(remainingLocs).not.toContain("New");
    expect(remainingLocs).not.toContain("New Orlea");
  });

  it("allows deleting specific locations and top rates via deleteLocationStat and deleteTopMpdRecord", async () => {
    await recordRates(
      { ...sampleCriteria, location: "Chicago, IL" },
      [createRate("The McCormick Scottsdale", 28.2)],
      false
    );

    let stats = await getDashboardStats();
    expect(stats.allLocations.map((l) => l.location)).toContain("Chicago, IL");

    // Delete Chicago, IL
    await deleteLocationStat("Chicago, IL");

    stats = await getDashboardStats();
    expect(stats.allLocations.map((l) => l.location)).not.toContain("Chicago, IL");
    expect(stats.topMpds.map((t) => t.location)).not.toContain("Chicago, IL");
  });
});
