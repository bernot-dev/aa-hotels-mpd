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

let activeSearchKey: string | null = null;
let activeDates: string | null = null;
// Hotel IDs from the most recent results payload (one page of search results)
let currentPageHotelIds: string[] = [];
let searchTotalResults: number | null = null;
// The search whose total is kept in searchTotalResults
let totalSearchKey: string | null = null;
// The search's first reported total, and whether searchTotalResults has since settled on the
// count of hotels with rooms available
let initialSearchTotal: number | null = null;
let searchTotalSettled = false;

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

  // Search Session Invalidation: If a new search or dates arrive, clear stale entries. The search
  // key stays the same across a search's result pages, whose searchIds differ.
  const first = rates[0];
  const thisSearchKey = first.searchKey || first.searchId;
  const thisDates = first.checkInDate && first.checkOutDate
    ? `${first.checkInDate}_${first.checkOutDate}`
    : null;

  if (
    (thisSearchKey && activeSearchKey && thisSearchKey !== activeSearchKey) ||
    (thisDates && activeDates && thisDates !== activeDates)
  ) {
    hotelMpdRegistry.clear();
    hotelDataRegistry.clear();
    hotelPriceRegistry.clear();
    resetSearchTotal();
  }

  if (thisSearchKey) activeSearchKey = thisSearchKey;
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

function resetSearchTotal(): void {
  searchTotalResults = null;
  totalSearchKey = null;
  initialSearchTotal = null;
  searchTotalSettled = false;
}

/**
 * Records the search's total result count. A search keeps its first total until the site's final
 * availability poll reports the settled count (`settled`), which leaves out hotels with no rooms;
 * other later responses report drifting counts for the same search and are ignored.
 */
export function setSearchTotalResults(total: number | null, searchKey?: string, settled = false): void {
  if (typeof total === "number" && total > 0) {
    const sameSearch = !!searchKey && searchKey === totalSearchKey && searchTotalResults !== null;
    if (!sameSearch) {
      searchTotalResults = total;
      initialSearchTotal = total;
      searchTotalSettled = settled;
      totalSearchKey = searchKey ?? null;
    } else if (settled && !searchTotalSettled) {
      searchTotalResults = total;
      searchTotalSettled = true;
    } else {
      return;
    }
    persistToStorage();
  } else if (total === null) {
    resetSearchTotal();
    persistToStorage();
  }
}

export interface SearchTotalDetails {
  /** Total to show: the settled count once known, else the first count reported. */
  total: number | null;
  /** The first count reported for the search, which includes hotels with no rooms available. */
  initialTotal: number | null;
  settled: boolean;
}

export function getSearchTotalDetails(): SearchTotalDetails {
  return { total: searchTotalResults, initialTotal: initialSearchTotal, settled: searchTotalSettled };
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

export function clearHotelMpdRegistry(): void {
  hotelMpdRegistry.clear();
  hotelDataRegistry.clear();
  hotelPriceRegistry.clear();
  resetSearchTotal();
  activeSearchKey = null;
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

  // e.g. pin-123, hotel_123, propertyMarkerIcon-123
  const pinId = pin.id || pin.getAttribute("data-selenium") || "";
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
      current.getAttribute("data-hotelid") ||
      // Map sidebar cards
      (current.getAttribute("data-element-name") === "map-search-property-list" ? current.getAttribute("data-value") : null);
    if (directId && /^\d+$/.test(directId)) return directId;

    // 2. Element ID e.g. hotel-12345, property-12345
    const elemId = current.id;
    if (elemId) {
      const match = elemId.match(/(?:hotel|property)[-_]?(\d+)/i);
      if (match) return match[1];
    }

    current = current.parentElement;
  }

  // 3. Child links e.g. /accom/property?propertyId=12345 or hotelId=12345
  const links = card.querySelectorAll("a[href]");
  for (let i = 0; i < links.length; i++) {
    const href = links[i].getAttribute("href") || "";
    const match = href.match(/(?:propertyId|hotelId|hotel_id)=(\d+)/i);
    if (match) return match[1];
  }

  return null;
}

// MPD ratings use fixed thresholds: flights earn up to 11 miles per dollar (with Executive
// Platinum status), so under 12 has a more efficient alternative, and 20+ is among the best rates
// most markets offer.
export const MPD_FAIR = 12;
export const MPD_GOOD = 20;

/** Most miles AAdvantage Hotels awards for one booking, however long the stay. */
export const MAX_MILES_PER_BOOKING = 15000;

export function getMpdDot(mpd: number): "🟢" | "🟡" | "🔴" {
  if (mpd >= MPD_GOOD) return "🟢";
  if (mpd >= MPD_FAIR) return "🟡";
  return "🔴";
}

export function registerHotelPrice(hotelId: string, nightlyPrice: number): void {
  if (!hotelId || isNaN(nightlyPrice) || !isFinite(nightlyPrice) || nightlyPrice <= 0) return;
  hotelPriceRegistry.set(hotelId, nightlyPrice);
  persistToStorage();
}

/** Median nightly price of the hotels seen in the current search, or 0 before any are known. */
export function getSearchSetMedianPrice(): number {
  const values = Array.from(hotelPriceRegistry.values())
    .filter((v) => typeof v === "number" && v > 0)
    .sort((a, b) => a - b);
  if (values.length === 0) return 0;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

export type DollarSigns = "💲" | "💲💲" | "💲💲💲" | "💲💲💲💲";

/**
 * Rates a nightly price against the search's median nightly price, which a few very cheap or very
 * expensive hotels barely move: 💲 under 0.75x the median, 💲💲 up to 1.5x, 💲💲💲 up to 3x, and
 * 💲💲💲💲 above that.
 */
export function getPriceDollarSigns(nightlyPrice: number, medianPrice: number = getSearchSetMedianPrice()): DollarSigns {
  if (!(medianPrice > 0) || !(nightlyPrice > 0)) return "💲";
  const ratio = nightlyPrice / medianPrice;
  if (ratio < 0.75) return "💲";
  if (ratio <= 1.5) return "💲💲";
  if (ratio <= 3) return "💲💲💲";
  return "💲💲💲💲";
}

