// Shared Hotel MPD Registry and DOM ID extraction helpers
import { EnrichedHotelRate } from "./interceptor";

export type RawHotelRate = EnrichedHotelRate;

export const hotelMpdRegistry = new Map<string, number>();
export const hotelDataRegistry = new Map<string, EnrichedHotelRate>();

const MPD_STORAGE_KEY = "aa_hotels_mpd_registry";
const DATA_STORAGE_KEY = "aa_hotels_data_registry";

let activeSearchId: string | null = null;
let activeDates: string | null = null;

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
  includeBonusMiles: boolean = false,
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

    const miles = includeBonusMiles
      ? tieredMiles || baseMiles
      : baseMiles || tieredMiles;

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
  includeBonusMiles: boolean = false
): number | undefined {
  const hotel = hotelDataRegistry.get(hotelId);
  if (!hotel) return undefined;
  const price = hotel.allInPrice > 0 ? hotel.allInPrice : hotel.price;
  if (price <= 0) return undefined;
  const miles = includeBonusMiles
    ? hotel.tieredMiles || hotel.baseMiles
    : hotel.baseMiles || hotel.tieredMiles;
  const mpd = miles / price;
  return mpd > 0 ? mpd : undefined;
}

export function getBaseMPD(
  hotelId: string,
  includeBonusMiles: boolean = false
): number | undefined {
  const hotel = hotelDataRegistry.get(hotelId);
  if (!hotel) return undefined;
  const price = hotel.basePrice > 0 ? hotel.basePrice : hotel.price;
  if (price <= 0) return undefined;
  const miles = includeBonusMiles
    ? hotel.tieredMiles || hotel.baseMiles
    : hotel.baseMiles || hotel.tieredMiles;
  const mpd = miles / price;
  return mpd > 0 ? mpd : undefined;
}

export function clearHotelMpdRegistry(): void {
  hotelMpdRegistry.clear();
  hotelDataRegistry.clear();
  activeSearchId = null;
  activeDates = null;
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
  const testId = pin.getAttribute("data-testid");
  if (!testId) return null;
  const match = testId.match(/^hotel-pin-(\d+)$/);
  return match ? match[1] : null;
}

export function getHotelIdFromCard(card: Element): string | null {
  let current: Element | null = card;
  while (current) {
    const testId = current.getAttribute("data-testid");
    if (testId) {
      const match = testId.match(/^hotel-card-(\d+)$/);
      if (match) return match[1];
    }
    current = current.parentElement;
  }
  const link =
    card.querySelector("[data-testid^=\"hotel-card-\"]") ||
    card.closest("[data-testid^=\"hotel-card-\"]");
  const match = link?.getAttribute("data-testid")?.match(/^hotel-card-(\d+)$/);
  return match ? match[1] : null;
}
