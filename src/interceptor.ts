// Network Interceptor running in MAIN world (document_start)
// Intercepts search and hotel API responses, parses enriched hotel rates and miles,
// and dispatches CustomEvent / postMessage to ISOLATED world content scripts.

export interface EnrichedHotelRate {
  hotelId: string;
  hotelName: string;
  price: number; // Defaults to allInPrice (or basePrice) for backward compatibility
  basePrice: number;
  allInPrice: number;
  nightlyPrice: number;
  fees: number;
  baseMiles: number;
  tieredMiles: number;
  city: string;
  state: string;
  location: string; // Canonical e.g. "Flagstaff, AZ"
  zipcode?: string;
  neighborhood?: string;
  latitude?: number;
  longitude?: number;
  stars?: number;
  rating?: number;
  reviewCount?: number;
  checkInDate?: string;
  checkOutDate?: string;
  nights?: number;
  refundable?: boolean;
  imageUrl?: string;
  searchId?: string;
}

export type RawHotelRate = EnrichedHotelRate;

export const EVENT_NAME = "AA_HOTELS_MPD_NETWORK_DATA";

const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "district of columbia": "DC",
};

export function normalizeCityName(rawCity: string): string {
  if (!rawCity || typeof rawCity !== "string") return "";
  let cleaned = rawCity.trim();
  // Strip trailing country indicators e.g. ", US", ", USA", ", United States"
  cleaned = cleaned.replace(/,\s*(?:US|USA|United States)$/i, "").trim();
  // Strip parentheticals e.g. "Flagstaff (AZ)" -> "Flagstaff"
  cleaned = cleaned.replace(/\s*\([A-Za-z\s]+\)$/, "").trim();
  return cleaned;
}

export function normalizeState(rawState: any): string {
  if (!rawState) return "";
  if (typeof rawState === "object") {
    if (rawState.code && typeof rawState.code === "string") {
      const code = rawState.code.trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(code)) return code;
    }
    if (rawState.name && typeof rawState.name === "string") {
      return normalizeState(rawState.name);
    }
    return "";
  }

  const str = String(rawState).trim();
  if (/^[A-Z]{2}$/i.test(str)) {
    return str.toUpperCase();
  }

  // Strip " State" e.g. "Arizona State" -> "Arizona"
  const cleaned = str.replace(/\s+State$/i, "").trim().toLowerCase();
  if (US_STATES[cleaned]) {
    return US_STATES[cleaned];
  }

  // Capitalize words if not matched in US state table
  return str.replace(/\s+State$/i, "").trim();
}

export function getCanonicalLocation(city: string, state: string): string {
  const cleanCity = normalizeCityName(city);
  const cleanState = normalizeState(state);

  if (!cleanCity) return cleanState || "";
  if (!cleanState) return cleanCity;

  // If city already contains the state code e.g. "Flagstaff, AZ"
  if (cleanCity.includes(",")) return cleanCity;

  return `${cleanCity}, ${cleanState}`;
}

/**
 * Dispatches intercepted hotel rates across the world boundary via CustomEvent and postMessage on window.
 * Also saves to sessionStorage to guarantee zero-drop sync across world initialization races.
 */
export function dispatchInterceptedRates(rates: EnrichedHotelRate[]): void {
  if (!rates || rates.length === 0) return;
  if (typeof window !== "undefined") {
    try {
      // 1. Shared sessionStorage buffer
      if (typeof sessionStorage !== "undefined") {
        try {
          sessionStorage.setItem("aa_hotels_latest_rates", JSON.stringify(rates));
        } catch {
          // Ignore quota or security errors
        }
      }

      // 2. Cross-world postMessage
      if (typeof window.postMessage === "function") {
        window.postMessage(
          {
            type: EVENT_NAME,
            hotels: rates,
          },
          "*"
        );
      }

      // 3. CustomEvent
      if (typeof window.dispatchEvent === "function") {
        window.dispatchEvent(
          new CustomEvent(EVENT_NAME, {
            detail: { hotels: rates },
          })
        );
      }
    } catch (err) {
      console.debug("[AA-Hotels-MPD] Failed to dispatch network rates event:", err);
    }
  }
}

/**
 * Extracts enriched hotel rates from arbitrary API response objects.
 * Handles Rocket Travel / Rocketmiles schema:
 * - payload.searchResult.results
 * - payload.results
 * - payload.hotels
 * - payload (as an array of hotel objects)
 */
export function extractHotelRatesFromPayload(payload: any): EnrichedHotelRate[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const searchId = payload.id || "";
  const checkInDate = payload.checkInDate || "";
  const checkOutDate = payload.checkOutDate || "";

  let nights = 1;
  if (checkInDate && checkOutDate) {
    const d1 = new Date(checkInDate);
    const d2 = new Date(checkOutDate);
    const diffDays = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > 0) {
      nights = diffDays;
    }
  }

  const searchPlace = payload.placeResult || payload.searchResult?.placeResult || {};
  const searchCity = searchPlace.city || "";
  const searchState = searchPlace.state || "";

  const hotelMap = new Map<string, EnrichedHotelRate>();

  const processHotelItem = (item: any) => {
    if (!item || typeof item !== "object") return;

    const rawId = item.hotel?.id ?? item.id ?? item.hotelId ?? item.propertyId ?? item.hotel?.propertyId;
    if (rawId === null || rawId === undefined) return;
    const hotelId = String(rawId).trim();
    if (!hotelId) return;

    const hotelName = item.hotel?.name || item.name || "Unknown Hotel";
    const economics = item.economics || item.roomTypeResultTeaser?.economics || item.rates?.[0]?.economics;

    let basePrice = 0;
    if (item.totalPrice?.amount) {
      basePrice = Number(item.totalPrice.amount);
    } else if (economics?.total?.amount) {
      basePrice = Number(economics.total.amount);
    } else if (economics?.displayPrice?.amount) {
      basePrice = Number(economics.displayPrice.amount);
    } else if (typeof item.price === "number") {
      basePrice = item.price;
    }

    const nightlyPrice = item.lowestAveragePrice?.amount
      ? Number(item.lowestAveragePrice.amount)
      : economics?.pricePerNight?.amount
      ? Number(economics.pricePerNight.amount)
      : 0;

    if (basePrice <= 0 && nightlyPrice > 0) {
      basePrice = nightlyPrice * nights;
    }

    let allInPrice = 0;
    if (item.grandTotalPublishedPriceInclusive?.amount) {
      allInPrice = Number(item.grandTotalPublishedPriceInclusive.amount);
    } else if (item.totalPriceInclusive?.amount) {
      allInPrice = Number(item.totalPriceInclusive.amount);
    } else if (economics?.totalInclusive?.amount) {
      allInPrice = Number(economics.totalInclusive.amount);
    } else {
      allInPrice = basePrice;
    }

    let fees = 0;
    if (typeof item.fees === "number") {
      fees = item.fees;
    } else if (item.fees?.amount) {
      fees = Number(item.fees.amount);
    }

    let baseMiles = 0;
    let tieredMiles = 0;

    if (economics) {
      baseMiles = Number(economics.rewardAmount || economics.baseRewardAmount || 0);
      tieredMiles = Number(economics.rewardAmountTiered || economics.tieredRewardAmount || baseMiles);
    } else {
      baseMiles = Number(item.rewards ?? item.rewardAmount ?? item.rewardMiles ?? item.totalRewards ?? 0);
      tieredMiles = Number(item.roomTypeResultTeaser?.rewards ?? item.rewardAmountTiered ?? baseMiles);
    }

    if (isNaN(basePrice)) basePrice = 0;
    if (isNaN(allInPrice) || allInPrice <= 0) allInPrice = basePrice;
    if (isNaN(baseMiles)) baseMiles = 0;
    if (isNaN(tieredMiles)) tieredMiles = baseMiles;

    if (allInPrice <= 0 && basePrice <= 0) return;
    if (baseMiles <= 0 && tieredMiles <= 0) return;

    // Location extraction & normalization
    const address = item.hotel?.address || item.address || {};
    const city = normalizeCityName(address.city || searchCity);
    const state = normalizeState(address.state || searchState);
    const location = getCanonicalLocation(city, state);
    const neighborhood =
      address.neighborhoodName ||
      item.neighborhoodName ||
      item.hotel?.neighborhood ||
      item.hotel?.neighborhoodName ||
      item.neighborhood ||
      "";
    const zipcode = address.zipcode || "";
    const latitude = address.latitude ?? item.latitude ?? searchPlace.latitude;
    const longitude = address.longitude ?? item.longitude ?? searchPlace.longitude;

    const stars = Number(item.hotel?.stars ?? item.stars ?? 0);
    const rating = Number(item.hotel?.rating ?? item.rating ?? 0);
    const reviewCount = Number(item.hotel?.numberOfReviews ?? item.numberOfReviews ?? 0);
    const imageUrl = item.hotel?.mainImage?.url ?? item.mainImage?.url ?? "";
    const refundable = item.refundability === "REFUNDABLE" || item.isRefundable === true;

    const enrichedRate: EnrichedHotelRate = {
      hotelId,
      hotelName,
      price: allInPrice > 0 ? allInPrice : basePrice,
      basePrice,
      allInPrice,
      nightlyPrice,
      fees,
      baseMiles,
      tieredMiles,
      city,
      state,
      location,
      neighborhood: neighborhood || undefined,
      zipcode: zipcode || undefined,
      latitude: !isNaN(latitude) ? Number(latitude) : undefined,
      longitude: !isNaN(longitude) ? Number(longitude) : undefined,
      stars: !isNaN(stars) && stars > 0 ? stars : undefined,
      rating: !isNaN(rating) && rating > 0 ? rating : undefined,
      reviewCount: !isNaN(reviewCount) && reviewCount > 0 ? reviewCount : undefined,
      imageUrl: imageUrl || undefined,
      refundable,
      checkInDate: checkInDate || undefined,
      checkOutDate: checkOutDate || undefined,
      nights,
      searchId: searchId || undefined,
    };

    const existing = hotelMap.get(hotelId);
    if (!existing) {
      hotelMap.set(hotelId, enrichedRate);
    } else {
      // If hotel already registered, keep the best rate/miles
      const existingMpd = existing.tieredMiles / existing.price;
      const newMpd = tieredMiles / (allInPrice > 0 ? allInPrice : basePrice);
      if (newMpd > existingMpd) {
        hotelMap.set(hotelId, enrichedRate);
      }
    }
  };

  // 1. Check standard results array locations
  const candidates: any[] = [];
  if (Array.isArray(payload)) {
    candidates.push(...payload);
  }
  if (Array.isArray(payload.searchResult?.results)) {
    candidates.push(...payload.searchResult.results);
  }
  if (Array.isArray(payload.results)) {
    candidates.push(...payload.results);
  }
  if (Array.isArray(payload.hotels)) {
    candidates.push(...payload.hotels);
  }

  candidates.forEach(processHotelItem);

  // 2. If nothing found in standard top-level arrays, do a bounded shallow scan
  if (hotelMap.size === 0) {
    for (const key of Object.keys(payload)) {
      const val = payload[key];
      if (Array.isArray(val)) {
        val.forEach(processHotelItem);
      } else if (val && typeof val === "object") {
        if (Array.isArray(val.results)) {
          val.results.forEach(processHotelItem);
        }
      }
    }
  }

  return Array.from(hotelMap.values());
}

export function shouldInspectUrl(url: string): boolean {
  if (!url) return true;
  const lower = url.toLowerCase();
  return (
    lower.includes("/search") ||
    lower.includes("/results") ||
    lower.includes("/hotels") ||
    lower.includes("aadvantage-hotels") ||
    lower.includes("/rest/")
  );
}

/**
 * Initializes monkey-patching on window.fetch and XMLHttpRequest.
 * Only runs once.
 */
let isInitialized = false;

export function initNetworkInterceptor(): void {
  if (isInitialized || typeof window === "undefined") return;
  isInitialized = true;

  // 1. Monkey-patch window.fetch
  if (typeof window.fetch === "function") {
    const originalFetch = window.fetch;
    window.fetch = async function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const response = await originalFetch.call(this, input, init);
      try {
        const url =
          typeof input === "string"
            ? input
            : "url" in input
            ? input.url
            : input.toString();
        if (shouldInspectUrl(url)) {
          response
            .clone()
            .json()
            .then((data) => {
              const rates = extractHotelRatesFromPayload(data);
              dispatchInterceptedRates(rates);
            })
            .catch(() => {});
        }
      } catch {
        // Ignore inspection errors to never interfere with page functionality
      }
      return response;
    };
  }

  // 2. Monkey-patch XMLHttpRequest
  if (typeof XMLHttpRequest !== "undefined") {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      ...rest: any[]
    ) {
      (this as any)._aaMpdUrl = typeof url === "string" ? url : url.toString();
      return (originalOpen as any).apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (
      body?: Document | XMLHttpRequestBodyInit | null
    ) {
      this.addEventListener("load", function () {
        try {
          const url = (this as any)._aaMpdUrl || "";
          if (shouldInspectUrl(url)) {
            const text = this.responseText;
            if (text && (text.startsWith("{") || text.startsWith("["))) {
              const data = JSON.parse(text);
              const rates = extractHotelRatesFromPayload(data);
              dispatchInterceptedRates(rates);
            }
          }
        } catch {
          // Ignore inspection errors
        }
      });
      return originalSend.call(this, body);
    };
  }
}

// Auto-run interceptor when script is executed in MAIN world
if (typeof window !== "undefined") {
  initNetworkInterceptor();
}
