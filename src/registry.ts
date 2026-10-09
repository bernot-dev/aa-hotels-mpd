// Shared Hotel MPD Registry and DOM ID extraction helpers
import { EnrichedHotelRate } from "./interceptor";
import { DEFAULT_EARNING_LEVEL, EarningLevel, milesForEarningLevel } from "./settings";

export type RawHotelRate = EnrichedHotelRate;

export const hotelMpdRegistry = new Map<string, number>();
export const hotelDataRegistry = new Map<string, EnrichedHotelRate>();
export const hotelPriceRegistry = new Map<string, number>();

const MPD_STORAGE_KEY = "aa_hotels_mpd_registry";
const DATA_STORAGE_KEY = "aa_hotels_data_registry";
const PRICE_STORAGE_KEY = "aa_hotels_price_registry";
const TOTAL_STORAGE_KEY = "aa_hotels_total_registry";

let activeSearchId: string | null = null;
let activeDates: string | null = null;
// Hotel IDs from the most recent results payload (one page of search results)
let currentPageHotelIds: string[] = [];
let searchTotalResults: number | null = null;

// Initialize from sessionStorage if available
try {
  if (typeof sessionStorage !== "undefined") {
    // 1. Restore MPD registry
    const rawMpd = sessionStorage.getItem(MPD_STORAGE_KEY);
    if (rawMpd) {
      const parsed = JSON.parse(rawMpd);
      if (typeof parsed === "object" && parsed !== null) {
        for (const id of Object.keys(parsed)) {
          const mpd = (parsed as Record<string, number>)[id];
          if (typeof mpd === "number" && mpd > 0) {
            hotelMpdRegistry.set(id, mpd);
          }
        }
      }
    }

    // 2. Restore enriched data registry
    const rawData = sessionStorage.getItem(DATA_STORAGE_KEY);
    if (rawData) {
      const parsed = JSON.parse(rawData);
      if (Array.isArray(parsed)) {
        parsed.forEach((item: EnrichedHotelRate) => {
          if (item?.hotelId) {
            hotelDataRegistry.set(item.hotelId, item);
          }
        });
      }
    }

    // 3. Restore price registry
    const rawPrices = sessionStorage.getItem(PRICE_STORAGE_KEY);
    if (rawPrices) {
      const parsed = JSON.parse(rawPrices);
      if (typeof parsed === "object" && parsed !== null) {
        for (const id of Object.keys(parsed)) {
          const price = (parsed as Record<string, number>)[id];
          if (typeof price === "number" && price > 0) {
            hotelPriceRegistry.set(id, price);
          }
        }
      }
    }

    // 4. Restore total search results count
    const rawTotal = sessionStorage.getItem(TOTAL_STORAGE_KEY);
    if (rawTotal) {
      const parsed = Number(rawTotal);
      if (!isNaN(parsed) && parsed > 0) {
        searchTotalResults = parsed;
      }
    }
  }
} catch {
  // Ignore storage access errors
}

function persistToStorage(): void {
  try {
    if (typeof sessionStorage !== "undefined") {
      const obj: Record<string, number> = {};
      hotelMpdRegistry.forEach((mpd, id) => {
        obj[id] = mpd;
      });
      sessionStorage.setItem(MPD_STORAGE_KEY, JSON.stringify(obj));

      const dataArray = Array.from(hotelDataRegistry.values());
      sessionStorage.setItem(DATA_STORAGE_KEY, JSON.stringify(dataArray));

      const priceObj: Record<string, number> = {};
      hotelPriceRegistry.forEach((price, id) => {
        priceObj[id] = price;
      });
      sessionStorage.setItem(PRICE_STORAGE_KEY, JSON.stringify(priceObj));

      if (typeof searchTotalResults === "number" && searchTotalResults > 0) {
        sessionStorage.setItem(TOTAL_STORAGE_KEY, String(searchTotalResults));
      } else {
        sessionStorage.removeItem(TOTAL_STORAGE_KEY);
      }
    }
  } catch {
    // Ignore storage write errors
  }
}

/**
 * Ingests enriched hotel rates from network interceptor.
 * Avoids race conditions by checking searchId/dates and invalidating stale queries.
 * Calculates MPD using All-In Price (Taxes & Fees) by default.
 */
export function ingestHotelRates(
  rates: EnrichedHotelRate[],
  earningLevel: EarningLevel = DEFAULT_EARNING_LEVEL,
  useAllInPricing: boolean = true
): number {
  if (!rates || rates.length === 0) return 0;

  // Search Session Invalidation: If new search ID or dates arrive, clear stale entries
  const first = rates[0];
  const thisSearchId = first.searchId;
  const thisDates = first.checkInDate && first.checkOutDate
    ? `${first.checkInDate}_${first.checkOutDate}`
    : null;

  if (
    (thisSearchId && activeSearchId && thisSearchId !== activeSearchId) ||
    (thisDates && activeDates && thisDates !== activeDates)
  ) {
    hotelMpdRegistry.clear();
    hotelDataRegistry.clear();
    hotelPriceRegistry.clear();
    searchTotalResults = null;
  }

  if (thisSearchId) activeSearchId = thisSearchId;
  if (thisDates) activeDates = thisDates;
  currentPageHotelIds = rates.map((r) => r.hotelId).filter(Boolean);

  let updatedCount = 0;

  rates.forEach((rate) => {
    const { hotelId, baseMiles, tieredMiles } = rate;
    if (!hotelId) return;

    // Save enriched hotel object
    hotelDataRegistry.set(hotelId, rate);

    const price = (useAllInPricing && rate.allInPrice > 0)
      ? rate.allInPrice
      : (rate.basePrice > 0 ? rate.basePrice : rate.price);

    if (price <= 0) return;

    const nightlyPrice = (useAllInPricing && rate.nightlyPrice > 0)
      ? rate.nightlyPrice
      : (rate.nights && rate.nights > 0 ? price / rate.nights : price);
    if (nightlyPrice > 0) {
      hotelPriceRegistry.set(hotelId, nightlyPrice);
    }

    const miles = milesForEarningLevel(baseMiles, tieredMiles, earningLevel);

    if (miles <= 0) return;

    const mpd = miles / price;
    if (isNaN(mpd) || !isFinite(mpd) || mpd <= 0) return;

    const prev = hotelMpdRegistry.get(hotelId) || 0;
    if (mpd > prev) {
      hotelMpdRegistry.set(hotelId, mpd);
      updatedCount++;
    }
  });

  if (updatedCount > 0 || hotelDataRegistry.size > 0 || hotelPriceRegistry.size > 0) {
    persistToStorage();
  }
  return updatedCount;
}

/**
 * Best MPD among hotels in the most recent results payload, falling back to the whole registry
 * when no payload has been seen yet (e.g. DOM-only processing).
 */
export function getCurrentPageBestMPD(): number {
  const ids = currentPageHotelIds.length > 0 ? currentPageHotelIds : Array.from(hotelMpdRegistry.keys());
  let best = 0;
  for (const id of ids) {
    const mpd = hotelMpdRegistry.get(id) || 0;
    if (mpd > best) best = mpd;
  }
  return best;
}

/**
 * Best MPD across all known/considered hotels for the current destination search.
 */
export function getLocationBestMPD(): number {
  let best = 0;
  for (const mpd of hotelMpdRegistry.values()) {
    if (mpd > best) best = mpd;
  }
  return best;
}

export function setSearchTotalResults(total: number | null): void {
  if (typeof total === "number" && total > 0) {
    searchTotalResults = total;
    persistToStorage();
  } else if (total === null) {
    searchTotalResults = null;
    persistToStorage();
  }
}

export function getSearchTotalResults(): number | null {
  return searchTotalResults;
}

export function getConsideredHotelsCount(): number {
  return hotelMpdRegistry.size > 0 ? hotelMpdRegistry.size : hotelDataRegistry.size;
}

export function isAllResultsConsidered(): boolean {
  if (typeof searchTotalResults === "number" && searchTotalResults > 0) {
    const considered = getConsideredHotelsCount();
    return considered >= searchTotalResults;
  }
  return false;
}

export function registerHotelMPD(hotelId: string, mpd: number): void {
  if (!hotelId || isNaN(mpd) || !isFinite(mpd) || mpd <= 0) return;
  const current = hotelMpdRegistry.get(hotelId) || 0;
  if (mpd > current) {
    hotelMpdRegistry.set(hotelId, mpd);
    persistToStorage();
  }
}

export function getHotelMPD(hotelId: string): number | undefined {
  return hotelMpdRegistry.get(hotelId);
}

export function getEnrichedHotel(hotelId: string): EnrichedHotelRate | undefined {
  return hotelDataRegistry.get(hotelId);
}

export function getAllEnrichedHotels(): EnrichedHotelRate[] {
  return Array.from(hotelDataRegistry.values());
}

export function getAllInMPD(
  hotelId: string,
  earningLevel: EarningLevel = DEFAULT_EARNING_LEVEL
): number | undefined {
  const hotel = hotelDataRegistry.get(hotelId);
  if (!hotel) return undefined;
  const price = hotel.allInPrice > 0 ? hotel.allInPrice : hotel.price;
  if (price <= 0) return undefined;
  const miles = milesForEarningLevel(hotel.baseMiles, hotel.tieredMiles, earningLevel);
  const mpd = miles / price;
  return mpd > 0 ? mpd : undefined;
}

export function getBaseMPD(
  hotelId: string,
  earningLevel: EarningLevel = DEFAULT_EARNING_LEVEL
): number | undefined {
  const hotel = hotelDataRegistry.get(hotelId);
  if (!hotel) return undefined;
  const price = hotel.basePrice > 0 ? hotel.basePrice : hotel.price;
  if (price <= 0) return undefined;
  const miles = milesForEarningLevel(hotel.baseMiles, hotel.tieredMiles, earningLevel);
  const mpd = miles / price;
  return mpd > 0 ? mpd : undefined;
}

export function clearHotelMpdRegistry(): void {
  hotelMpdRegistry.clear();
  hotelDataRegistry.clear();
  hotelPriceRegistry.clear();
  searchTotalResults = null;
  activeSearchId = null;
  activeDates = null;
  currentPageHotelIds = [];
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(MPD_STORAGE_KEY);
      sessionStorage.removeItem(DATA_STORAGE_KEY);
      sessionStorage.removeItem(PRICE_STORAGE_KEY);
      sessionStorage.removeItem(TOTAL_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export function getHotelIdFromPin(pin: Element): string | null {
  const directId =
    pin.getAttribute("data-property-id") ||
    pin.getAttribute("data-propertyid") ||
    pin.getAttribute("data-hotel-id") ||
    pin.getAttribute("data-hotelid") ||
    pin.getAttribute("data-id");
  if (directId && /^\d+$/.test(directId)) return directId;

  const testId = pin.getAttribute("data-testid") || "";
  const testIdMatch = testId.match(/^hotel-pin-(\d+)$/);
  if (testIdMatch) return testIdMatch[1];

  // e.g. pin-123, hotel_123, propertyMarkerIcon-123
  const pinId = pin.id || pin.getAttribute("data-selenium") || testId;
  const match = pinId.match(/(?:pin|hotel|property(?:MarkerIcon)?)[-_]?(\d+)/i);
  return match ? match[1] : null;
}

export function getHotelIdFromCard(card: Element): string | null {
  let current: Element | null = card;
  while (current) {
    // 1. Direct attribute inspection
    const directId =
      current.getAttribute("data-property-id") ||
      current.getAttribute("data-propertyid") ||
      current.getAttribute("data-hotel-id") ||
      current.getAttribute("data-hotelid");
    if (directId && /^\d+$/.test(directId)) return directId;

    // 2. data-testid inspection e.g. hotel-card-12345
    const testId = current.getAttribute("data-testid");
    if (testId) {
      const match = testId.match(/^hotel-card-(\d+)$/);
      if (match) return match[1];
    }

    // 3. Element ID e.g. hotel-12345, property-12345
    const elemId = current.id;
    if (elemId) {
      const match = elemId.match(/(?:hotel|property)[-_]?(\d+)/i);
      if (match) return match[1];
    }

    current = current.parentElement;
  }

  // 4. Closest or child with data-testid^="hotel-card-"
  const testIdElem =
    card.querySelector('[data-testid^="hotel-card-"]') ||
    card.closest('[data-testid^="hotel-card-"]');
  const testIdMatch = testIdElem?.getAttribute("data-testid")?.match(/^hotel-card-(\d+)$/);
  if (testIdMatch) return testIdMatch[1];

  // 5. Child links e.g. /accom/property?propertyId=12345 or hotelId=12345
  const links = card.querySelectorAll("a[href]");
  for (let i = 0; i < links.length; i++) {
    const href = links[i].getAttribute("href") || "";
    const match = href.match(/(?:propertyId|hotelId|hotel_id)=(\d+)/i);
    if (match) return match[1];
  }

  return null;
}

export function getSearchSetMpdRange(): { minMpd: number; maxMpd: number } {
  const values = Array.from(hotelMpdRegistry.values()).filter((v) => typeof v === "number" && v > 0);
  if (values.length === 0) return { minMpd: 0, maxMpd: 0 };
  return {
    minMpd: Math.min(...values),
    maxMpd: Math.max(...values),
  };
}

export function getMpdDot(mpd: number, minMpd?: number, maxMpd?: number): "🟢" | "🟡" | "🔴" {
  if (minMpd === undefined || maxMpd === undefined || maxMpd <= 0) {
    const range = getSearchSetMpdRange();
    minMpd = range.minMpd;
    maxMpd = range.maxMpd;
  }
  if (maxMpd <= minMpd || minMpd <= 0) {
    return "🟢";
  }
  const ratio = (mpd - minMpd) / (maxMpd - minMpd);
  if (ratio >= 0.66) return "🟢";
  if (ratio <= 0.33) return "🔴";
  return "🟡";
}

export function registerHotelPrice(hotelId: string, nightlyPrice: number): void {
  if (!hotelId || isNaN(nightlyPrice) || !isFinite(nightlyPrice) || nightlyPrice <= 0) return;
  hotelPriceRegistry.set(hotelId, nightlyPrice);
  persistToStorage();
}

export function getSearchSetPriceRange(): { minPrice: number; maxPrice: number } {
  const values = Array.from(hotelPriceRegistry.values()).filter((v) => typeof v === "number" && v > 0);
  if (values.length === 0) return { minPrice: 0, maxPrice: 0 };
  return {
    minPrice: Math.min(...values),
    maxPrice: Math.max(...values),
  };
}

/**
 * Rates a hotel with 1-3 dollar sign emojis (💲, 💲💲, 💲💲💲).
 * The most expensive options in the search have 3 dollar signs. The least expensive have 1 dollar sign.
 */
export function getPriceDollarSigns(
  nightlyPrice: number,
  minPrice?: number,
  maxPrice?: number
): "💲" | "💲💲" | "💲💲💲" {
  if (minPrice === undefined || maxPrice === undefined || maxPrice <= 0) {
    const range = getSearchSetPriceRange();
    minPrice = range.minPrice;
    maxPrice = range.maxPrice;
  }

  if (maxPrice <= minPrice || minPrice <= 0) {
    return "💲";
  }

  const ratio = (nightlyPrice - minPrice) / (maxPrice - minPrice);
  if (ratio <= 0.33) return "💲";
  if (ratio <= 0.66) return "💲💲";
  return "💲💲💲";
}

