// Shared Hotel MPD Registry and DOM ID extraction helpers
import { EnrichedHotelRate } from "./interceptor";
import { DEFAULT_EARNING_LEVEL, EarningLevel, milesForEarningLevel } from "./settings";

export type RawHotelRate = EnrichedHotelRate;

export const hotelMpdRegistry = new Map<string, number>();
export const hotelDataRegistry = new Map<string, EnrichedHotelRate>();

const MPD_STORAGE_KEY = "aa_hotels_mpd_registry";
const DATA_STORAGE_KEY = "aa_hotels_data_registry";

let activeSearchId: string | null = null;
let activeDates: string | null = null;
// Hotel IDs from the most recent results payload (one page of search results)
let currentPageHotelIds: string[] = [];

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

  if (updatedCount > 0 || hotelDataRegistry.size > 0) {
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
  activeSearchId = null;
  activeDates = null;
  currentPageHotelIds = [];
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(MPD_STORAGE_KEY);
      sessionStorage.removeItem(DATA_STORAGE_KEY);
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
