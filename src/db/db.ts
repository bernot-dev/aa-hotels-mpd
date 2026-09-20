import {
  SearchCriteria,
  CapturedRate,
  TopMpdRecord,
  LocationStatRecord,
  NightStatRecord,
  ExhaustiveQueryRecord,
  DashboardStats,
} from "../types";

export const DB_NAME = "AAHotelsMPD";
export const DB_VERSION = 1;

export const STORES = {
  TOP_MPDS: "top_mpds",
  LOCATION_STATS: "location_stats",
  NIGHTS_STATS: "nights_stats",
  EXHAUSTIVE_QUERIES: "exhaustive_queries",
} as const;

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 1. Top MPDs (top 100 all-time)
      if (!db.objectStoreNames.contains(STORES.TOP_MPDS)) {
        const topStore = db.createObjectStore(STORES.TOP_MPDS, { keyPath: "id" });
        topStore.createIndex("mpd", "mpd", { unique: false });
        topStore.createIndex("timestamp", "timestamp", { unique: false });
      }

      // 2. Location Stats (up to 100 locations)
      if (!db.objectStoreNames.contains(STORES.LOCATION_STATS)) {
        const locStore = db.createObjectStore(STORES.LOCATION_STATS, { keyPath: "location" });
        locStore.createIndex("topMpd", "topMpd", { unique: false });
      }

      // 3. Nights Stats (1..N nights)
      if (!db.objectStoreNames.contains(STORES.NIGHTS_STATS)) {
        db.createObjectStore(STORES.NIGHTS_STATS, { keyPath: "nights" });
      }

      // 4. Exhaustive Queries
      if (!db.objectStoreNames.contains(STORES.EXHAUSTIVE_QUERIES)) {
        const queryStore = db.createObjectStore(STORES.EXHAUSTIVE_QUERIES, {
          keyPath: "id",
          autoIncrement: true,
        });
        queryStore.createIndex("queryTimestamp", "queryTimestamp", { unique: false });
        queryStore.createIndex("location", "location", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllFromStore<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function countStore(store: IDBObjectStore): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = store.count();
    request.onsuccess = () => resolve(request.result || 0);
    request.onerror = () => reject(request.error);
  });
}

export async function recordRates(
  criteria: SearchCriteria,
  rates: CapturedRate[],
  keepExhaustive: boolean
): Promise<void> {
  if (!rates || rates.length === 0) {
    return;
  }

  const db = await openDatabase();

  const storeNames = keepExhaustive
    ? [STORES.TOP_MPDS, STORES.LOCATION_STATS, STORES.NIGHTS_STATS, STORES.EXHAUSTIVE_QUERIES]
    : [STORES.TOP_MPDS, STORES.LOCATION_STATS, STORES.NIGHTS_STATS];

  const tx = db.transaction(storeNames, "readwrite");
  const topStore = tx.objectStore(STORES.TOP_MPDS);
  const locStore = tx.objectStore(STORES.LOCATION_STATS);
  const nightsStore = tx.objectStore(STORES.NIGHTS_STATS);

  // 1. Process Top MPDs (maintain top 100 all-time)
  const existingTop = await getAllFromStore<TopMpdRecord>(topStore);
  const topMap = new Map<string, TopMpdRecord>();
  for (const item of existingTop) {
    topMap.set(item.id, item);
  }

  for (const rate of rates) {
    if (!rate.mpd || rate.mpd <= 0) continue;

    const recordId = `${criteria.location}_${rate.hotelName}_${criteria.checkIn}_${criteria.checkOut}_${rate.price}_${rate.miles}`;
    const newRecord: TopMpdRecord = {
      id: recordId,
      mpd: Number(rate.mpd.toFixed(1)),
      hotelName: rate.hotelName,
      hotelId: rate.hotelId,
      location: criteria.location,
      checkIn: criteria.checkIn,
      checkOut: criteria.checkOut,
      nights: criteria.nights,
      rooms: criteria.rooms,
      guests: criteria.guests,
      price: rate.price,
      miles: rate.miles,
      timestamp: criteria.timestamp,
    };

    topMap.set(recordId, newRecord);
  }

  // Sort descending by mpd
  const sortedTop = Array.from(topMap.values()).sort((a, b) => b.mpd - a.mpd);
  const top100 = sortedTop.slice(0, 100);
  const keepIds = new Set(top100.map((r) => r.id));

  // Save top 100
  for (const record of top100) {
    topStore.put(record);
  }

  // Delete records dropped below rank 100
  for (const item of existingTop) {
    if (!keepIds.has(item.id)) {
      topStore.delete(item.id);
    }
  }

  // 2. Process Location Stats (maintain up to 100 locations)
  const normalizedLoc = criteria.location.trim();
  if (normalizedLoc) {
    const existingLocs = await getAllFromStore<LocationStatRecord>(locStore);
    const locMap = new Map<string, LocationStatRecord>();
    for (const l of existingLocs) {
      locMap.set(l.location.toLowerCase(), l);
    }

    const currentLocRecord = locMap.get(normalizedLoc.toLowerCase());
    const bestRateInBatch = rates.reduce(
      (best, cur) => (cur.mpd > (best?.mpd || 0) ? cur : best),
      null as CapturedRate | null
    );

    if (bestRateInBatch) {
      const bestMpd = Number(bestRateInBatch.mpd.toFixed(1));

      if (currentLocRecord) {
        currentLocRecord.observationCount += rates.length;
        if (bestMpd > currentLocRecord.topMpd) {
          currentLocRecord.topMpd = bestMpd;
          currentLocRecord.hotelName = bestRateInBatch.hotelName;
          currentLocRecord.checkIn = criteria.checkIn;
          currentLocRecord.checkOut = criteria.checkOut;
          currentLocRecord.nights = criteria.nights;
          currentLocRecord.price = bestRateInBatch.price;
          currentLocRecord.miles = bestRateInBatch.miles;
          currentLocRecord.timestamp = criteria.timestamp;
        }
        locStore.put(currentLocRecord);
      } else {
        const newLocRecord: LocationStatRecord = {
          location: normalizedLoc,
          topMpd: bestMpd,
          hotelName: bestRateInBatch.hotelName,
          checkIn: criteria.checkIn,
          checkOut: criteria.checkOut,
          nights: criteria.nights,
          price: bestRateInBatch.price,
          miles: bestRateInBatch.miles,
          timestamp: criteria.timestamp,
          observationCount: rates.length,
        };

        if (locMap.size < 100) {
          locStore.put(newLocRecord);
        } else {
          // If already 100 locations, check if this new location has higher topMpd than the lowest existing
          const sortedLocs = Array.from(locMap.values()).sort((a, b) => a.topMpd - b.topMpd);
          const lowestLoc = sortedLocs[0];
          if (lowestLoc && bestMpd > lowestLoc.topMpd) {
            locStore.delete(lowestLoc.location);
            locStore.put(newLocRecord);
          }
        }
      }
    }
  }

  // 3. Process Nights Stats (track top MPD for any number of nights)
  if (criteria.nights && criteria.nights > 0) {
    const existingNight = await new Promise<NightStatRecord | undefined>((resolve, reject) => {
      const req = nightsStore.get(criteria.nights);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const bestRateInBatch = rates.reduce(
      (best, cur) => (cur.mpd > (best?.mpd || 0) ? cur : best),
      null as CapturedRate | null
    );

    if (bestRateInBatch) {
      const bestMpd = Number(bestRateInBatch.mpd.toFixed(1));
      if (!existingNight || bestMpd > existingNight.topMpd) {
        const newNightRecord: NightStatRecord = {
          nights: criteria.nights,
          topMpd: bestMpd,
          hotelName: bestRateInBatch.hotelName,
          location: criteria.location,
          checkIn: criteria.checkIn,
          checkOut: criteria.checkOut,
          price: bestRateInBatch.price,
          miles: bestRateInBatch.miles,
          timestamp: criteria.timestamp,
        };
        nightsStore.put(newNightRecord);
      }
    }
  }

  // 4. Record to exhaustive history if enabled
  if (keepExhaustive) {
    const queryStore = tx.objectStore(STORES.EXHAUSTIVE_QUERIES);
    const exhaustiveRecord: ExhaustiveQueryRecord = {
      queryTimestamp: criteria.timestamp,
      location: criteria.location,
      checkIn: criteria.checkIn,
      checkOut: criteria.checkOut,
      nights: criteria.nights,
      rooms: criteria.rooms,
      guests: criteria.guests,
      pageUrl: criteria.url,
      rates: rates.map((r) => ({
        hotelName: r.hotelName,
        hotelId: r.hotelId,
        price: r.price,
        miles: r.miles,
        mpd: Number(r.mpd.toFixed(1)),
        isTotalPrice: r.isTotalPrice,
        isBonus: r.isBonus,
        roomType: r.roomType,
      })),
    };
    queryStore.add(exhaustiveRecord);
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
  });
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const db = await openDatabase();
  const tx = db.transaction([STORES.TOP_MPDS, STORES.LOCATION_STATS, STORES.NIGHTS_STATS], "readonly");

  const [topMpdsRaw, locationsRaw, nightsRaw] = await Promise.all([
    getAllFromStore<TopMpdRecord>(tx.objectStore(STORES.TOP_MPDS)),
    getAllFromStore<LocationStatRecord>(tx.objectStore(STORES.LOCATION_STATS)),
    getAllFromStore<NightStatRecord>(tx.objectStore(STORES.NIGHTS_STATS)),
  ]);

  // Sort top MPDs descending
  const topMpds = topMpdsRaw.sort((a, b) => b.mpd - a.mpd);

  // Sort locations descending by topMpd
  const allLocations = locationsRaw.sort((a, b) => b.topMpd - a.topMpd);

  // Top 3 locations with highest MPD
  const topLocations = allLocations.slice(0, 3);

  // 3 locations with lowest MPD (take the bottom 3 from sorted list, sorted ascending)
  const lowestLocations = allLocations.slice(-3).reverse();

  // Nights map
  const nightsStats: Record<number, NightStatRecord> = {};
  for (const n of nightsRaw) {
    nightsStats[n.nights] = n;
  }

  return {
    topMpds,
    allLocations,
    topLocations,
    lowestLocations,
    nightsStats,
  };
}

export async function getExhaustiveQueries(): Promise<ExhaustiveQueryRecord[]> {
  const db = await openDatabase();
  const tx = db.transaction(STORES.EXHAUSTIVE_QUERIES, "readonly");
  return getAllFromStore<ExhaustiveQueryRecord>(tx.objectStore(STORES.EXHAUSTIVE_QUERIES));
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export async function getStorageEstimate(): Promise<{
  count: number;
  bytes: number;
  humanized: string;
}> {
  const db = await openDatabase();
  const tx = db.transaction(STORES.EXHAUSTIVE_QUERIES, "readonly");
  const store = tx.objectStore(STORES.EXHAUSTIVE_QUERIES);

  const count = await countStore(store);
  if (count === 0) {
    return { count: 0, bytes: 0, humanized: "0 queries (0 B)" };
  }

  const queries = await getAllFromStore<ExhaustiveQueryRecord>(store);
  const jsonString = JSON.stringify(queries);
  const bytes = new Blob([jsonString]).size;

  return {
    count,
    bytes,
    humanized: `${count} queries (${formatBytes(bytes)})`,
  };
}

export async function clearExhaustiveHistory(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORES.EXHAUSTIVE_QUERIES, "readwrite");
  tx.objectStore(STORES.EXHAUSTIVE_QUERIES).clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllData(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(
    [STORES.TOP_MPDS, STORES.LOCATION_STATS, STORES.NIGHTS_STATS, STORES.EXHAUSTIVE_QUERIES],
    "readwrite"
  );
  tx.objectStore(STORES.TOP_MPDS).clear();
  tx.objectStore(STORES.LOCATION_STATS).clear();
  tx.objectStore(STORES.NIGHTS_STATS).clear();
  tx.objectStore(STORES.EXHAUSTIVE_QUERIES).clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
