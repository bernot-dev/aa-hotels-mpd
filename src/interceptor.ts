// Network Interceptor running in MAIN world (document_start)
// Intercepts search and hotel API responses, parses enriched hotel rates and miles,
// and dispatches CustomEvent / postMessage to ISOLATED world content scripts.

import { initListExpander } from "./list-expander";

export interface EnrichedHotelRate {
  hotelId: string;
  hotelName: string;
  price: number; // Defaults to allInPrice (or basePrice) for backward compatibility
  basePrice: number;
  allInPrice: number; // Room + taxes + all fees, including fees paid at the property
  /** Totals the site may be displaying for this rate, used to recognize which price is on screen. */
  sitePriceTotals?: number[];
  nightlyPrice: number;
  fees: number;
  baseMiles: number; // Base miles for "AAdvantage member"
  tieredMiles: number; // Base miles for "AAdvantage credit cardmembers with status" (>= baseMiles)
  city: string;
  state: string;
  location: string; // Canonical e.g. "Flagstaff, AZ"
  country?: string;
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
  /** Identifies the search across its result pages (see getSearchKey); the site gives each page its own searchId. */
  searchKey?: string;
}

export type RawHotelRate = EnrichedHotelRate;

/** A room rate from the details page's room grid. */
export interface RoomRate {
  /** The rate's `roomIdentifiers`, which its room card carries as `data-room-identifier`. */
  roomId: string;
  allInPrice: number;
  sitePriceTotals: number[];
  nights: number;
}

type ApiObject = { [key: string]: unknown };

const field = (value: unknown, key: string): unknown =>
  value && typeof value === "object" ? (value as ApiObject)[key] : undefined;

const amountOf = (value: unknown): number => {
  const amount = Number(field(value, "amount") ?? NaN);
  return isFinite(amount) && amount > 0 ? amount : 0;
};

/**
 * All-in total: room + taxes + every fee, including resort/property fees paid at the hotel.
 * Falls back to taxes-only totals for payloads that lack the fees-inclusive field.
 */
export function getAllInTotal(item: unknown): number {
  return (
    amountOf(field(item, "grandTotalPublishedPriceInclusiveWithFees")) ||
    amountOf(field(item, "grandTotalPublishedPriceInclusive")) ||
    amountOf(field(item, "totalPriceInclusive")) ||
    amountOf(field(field(item, "economics"), "totalInclusive"))
  );
}

/** Totals the site may be showing instead of the all-in total, depending on the searcher's jurisdiction. */
export function getSitePriceTotals(item: unknown): number[] {
  return [
    amountOf(field(item, "grandTotalPublishedPriceWithPropertyTaxAndCounterFees")),
    amountOf(field(item, "totalPrice")),
    amountOf(field(item, "grandTotalPublishedPriceInclusive")),
    amountOf(field(field(item, "economics"), "total")),
  ].filter((amount, i, all) => amount > 0 && all.indexOf(amount) === i);
}

export const EVENT_NAME = "AA_HOTELS_MPD_NETWORK_DATA";

/** Called with every inspected response. Only development builds install one (see debug-recorder.ts). */
type NetworkRecorder = (url: string, method: string, response: unknown, requestBody?: unknown) => void;
let networkRecorder: NetworkRecorder | null = null;

export function setNetworkRecorder(recorder: NetworkRecorder | null): void {
  networkRecorder = recorder;
}

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

export function extractTotalFilteredHotels(payload: any): number | null {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.totalFilteredHotels === "number") {
    return payload.totalFilteredHotels;
  }
  if (typeof payload.searchResult?.searchInfo?.totalFilteredHotels === "number") {
    return payload.searchResult.searchInfo.totalFilteredHotels;
  }
  if (payload.data && typeof payload.data === "object") {
    for (const key of Object.keys(payload.data)) {
      const searchInfo = payload.data[key]?.searchResult?.searchInfo;
      if (typeof searchInfo?.totalFilteredHotels === "number") {
        return searchInfo.totalFilteredHotels;
      }
      if (typeof payload.data[key]?.searchResult?.totalFilteredHotels === "number") {
        return payload.data[key].searchResult.totalFilteredHotels;
      }
      if (typeof payload.data[key]?.totalProperties === "number") {
        return payload.data[key].totalProperties;
      }
    }
    if (typeof payload.data.searchResult?.searchInfo?.totalFilteredHotels === "number") {
      return payload.data.searchResult.searchInfo.totalFilteredHotels;
    }
  }
  if (typeof payload.totalProperties === "number") {
    return payload.totalProperties;
  }
  return null;
}

/**
 * Dispatches intercepted hotel rates across the world boundary via CustomEvent and postMessage on window.
 * Also saves to sessionStorage to guarantee zero-drop sync across world initialization races.
 */
export function dispatchInterceptedRates(
  rates: EnrichedHotelRate[],
  totalHotels?: number | null,
  searchKey?: string,
  totalIsSettled?: boolean
): void {
  if (!rates || rates.length === 0) return;
  if (typeof window !== "undefined") {
    try {
      // 1. Shared sessionStorage buffer
      if (typeof sessionStorage !== "undefined") {
        try {
          sessionStorage.setItem("aa_hotels_latest_rates", JSON.stringify(rates));
          if (typeof totalHotels === "number") {
            sessionStorage.setItem("aa_hotels_latest_total", String(totalHotels));
          }
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
            totalHotels: typeof totalHotels === "number" ? totalHotels : undefined,
            searchKey,
            totalIsSettled,
          },
          "*"
        );
      }

      // 3. CustomEvent
      if (typeof window.dispatchEvent === "function") {
        window.dispatchEvent(
          new CustomEvent(EVENT_NAME, {
            detail: {
              hotels: rates,
              totalHotels: typeof totalHotels === "number" ? totalHotels : undefined,
              searchKey,
              totalIsSettled,
            },
          })
        );
      }
    } catch (err) {
      console.debug("[AA-Hotels-MPD] Failed to dispatch network rates event:", err);
    }
  }
}

// Request fields that change between the requests of one search: the page itself, a per-request
// searchId, the time the request was made, and `synchronous`, set on the site's final
// availability poll
const PER_REQUEST_FIELDS = new Set(["page", "searchId", "bookingDate", "synchronous"]);

const withoutPerRequestFields = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutPerRequestFields);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (!PER_REQUEST_FIELDS.has(key)) out[key] = withoutPerRequestFields((value as Record<string, unknown>)[key]);
  }
  return out;
};

/**
 * Identifies a search across its result pages: a hash of the GraphQL request variables without
 * paging, the per-request searchId, or the request time. Undefined for other request bodies.
 */
export function getSearchKey(requestBody: unknown): string | undefined {
  let body: any = requestBody;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return undefined;
    }
  }
  if (!body?.variables || typeof body.variables !== "object") return undefined;
  const text = JSON.stringify(withoutPerRequestFields(body.variables));
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Whether a search request is the site's final availability poll (`synchronous: true`), whose
 * total leaves out hotels with no rooms available. Earlier responses count every matching hotel.
 */
export function isFinalAvailabilityPoll(requestBody: unknown): boolean {
  let body: any = requestBody;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return false;
    }
  }
  const variables = body?.variables;
  if (!variables || typeof variables !== "object") return false;
  return Object.keys(variables).some(
    (key) => variables[key]?.searchRequest?.searchCriteria?.synchronous === true
  );
}

/**
 * Reads the stay criteria from an Agoda GraphQL search request body
 * (variables.<X>SearchRequest.searchRequest.searchCriteria / searchContext).
 */
export function extractAgodaRequestCriteria(
  requestBody: unknown
): { checkInDate?: string; checkOutDate?: string; nights?: number; searchId?: string } {
  let body: any = requestBody;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return {};
    }
  }
  const variables = body?.variables;
  if (!variables || typeof variables !== "object") return {};

  for (const key of Object.keys(variables)) {
    const searchRequest = variables[key]?.searchRequest;
    const criteria = searchRequest?.searchCriteria;
    if (!criteria) continue;

    const checkInDate: string | undefined =
      criteria.localCheckInDate || (typeof criteria.checkInDate === "string" ? criteria.checkInDate.slice(0, 10) : undefined);
    const nights = Number(criteria.los) > 0 ? Number(criteria.los) : undefined;
    let checkOutDate: string | undefined;
    if (checkInDate && nights) {
      const out = new Date(`${checkInDate}T00:00:00Z`);
      if (!isNaN(out.getTime())) {
        out.setUTCDate(out.getUTCDate() + nights);
        checkOutDate = out.toISOString().slice(0, 10);
      }
    }
    return {
      checkInDate,
      checkOutDate,
      nights,
      searchId: searchRequest?.searchContext?.searchId || undefined,
    };
  }
  return {};
}

/**
 * Parses an Agoda "Dallas (TX)" style city name into city and state parts.
 */
function splitAgodaCityName(name: string): { city: string; state: string } {
  const match = name.match(/^(.+?)\s*\(([A-Za-z]{2})\)$/);
  if (match) return { city: match[1].trim(), state: match[2].toUpperCase() };
  return { city: name.trim(), state: "" };
}

/**
 * Extracts a property from the Agoda white-label GraphQL schema used by search.aadvantagehotels.com
 * (data.citySearch.properties[]). Prices and miles live on the first displayed room offer:
 * pricing.offers[0].roomOffers[0].room.pricing[0].price.perBook.{inclusive,exclusive}.
 */
function extractAgodaProperty(
  item: any,
  context: { checkInDate?: string; checkOutDate?: string; nights: number; searchId?: string }
): EnrichedHotelRate | null {
  const rawId = item.propertyId;
  if (rawId === null || rawId === undefined) return null;
  const hotelId = String(rawId).trim();
  if (!hotelId) return null;

  const roomPricing = item.pricing?.offers?.[0]?.roomOffers?.[0]?.room?.pricing?.[0];
  const perBook = roomPricing?.price?.perBook;
  if (!perBook) return null;

  // Miles per dollar is only meaningful for USD prices
  if (roomPricing.currency && roomPricing.currency !== "USD") return null;

  const allInPrice = Number(perBook.inclusive?.display) || 0;
  const basePrice = Number(perBook.exclusive?.display) || allInPrice;
  const nightlyPrice = Number(roomPricing.price?.perNight?.inclusive?.display) || 0;
  if (allInPrice <= 0 && basePrice <= 0) return null;

  // Loyalty offers are earning levels: the lowest is the "AAdvantage member" amount and the highest
  // the "AAdvantage credit cardmembers with status" amount. Both are base miles.
  const offers: any[] =
    perBook.inclusive?.loyaltyOfferSummary?.offers || perBook.exclusive?.loyaltyOfferSummary?.offers || [];
  const points = offers.map((o) => Number(o?.earn?.points) || 0).filter((p) => p > 0);
  if (points.length === 0) {
    const pointsToEarn = Number(roomPricing.externalLoyaltyPricing?.perBook?.pointsToEarn) || 0;
    if (pointsToEarn > 0) points.push(pointsToEarn);
  }
  const baseMiles = points.length > 0 ? Math.min(...points) : 0;
  const tieredMiles = points.length > 0 ? Math.max(...points) : 0;
  if (baseMiles <= 0) return null;

  const info = item.content?.informationSummary || {};
  const address = info.address || {};
  const cityName = typeof address.city?.name === "string" ? address.city.name : "";
  const { city, state } = splitAgodaCityName(cityName);
  const country = address.country?.name || address.countryCode || undefined;
  const reviews = item.content?.reviews?.cumulative || {};
  const rawImage = item.content?.images?.hotelImages?.[0]?.urls?.[0]?.value;
  const imageUrl = typeof rawImage === "string" ? (rawImage.startsWith("//") ? `https:${rawImage}` : rawImage) : undefined;
  const latitude = Number(info.geoInfo?.latitude);
  const longitude = Number(info.geoInfo?.longitude);
  const stars = Number(info.rating);
  const rating = Number(reviews.score);
  const reviewCount = Number(reviews.reviewCount);

  return {
    hotelId,
    hotelName: info.displayName || info.defaultName || "Unknown Hotel",
    price: allInPrice > 0 ? allInPrice : basePrice,
    basePrice,
    allInPrice: allInPrice > 0 ? allInPrice : basePrice,
    nightlyPrice,
    fees: allInPrice > basePrice ? Number((allInPrice - basePrice).toFixed(2)) : 0,
    baseMiles,
    tieredMiles,
    city,
    state,
    location: getCanonicalLocation(city, state),
    country: country === "US" ? "United States" : country,
    neighborhood: address.area?.name || undefined,
    latitude: isFinite(latitude) && latitude !== 0 ? latitude : undefined,
    longitude: isFinite(longitude) && longitude !== 0 ? longitude : undefined,
    stars: stars > 0 ? stars : undefined,
    rating: rating > 0 ? rating : undefined,
    reviewCount: reviewCount > 0 ? reviewCount : undefined,
    imageUrl,
    refundable: item.pricing?.payment?.cancellation?.cancellationType === "FreeCancellation",
    checkInDate: context.checkInDate,
    checkOutDate: context.checkOutDate,
    nights: context.nights,
    searchId: context.searchId,
  };
}

/**
 * Extracts enriched hotel rates from arbitrary API response objects.
 * Handles the Agoda white-label GraphQL schema (data.<x>Search.properties, data.propertyDetail.rooms).
 * The optional request body supplies stay dates for Agoda responses, which omit them.
 */
export function extractHotelRatesFromPayload(payload: any, requestBody?: unknown): EnrichedHotelRate[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const requestCriteria = requestBody ? extractAgodaRequestCriteria(requestBody) : {};
  const searchId = payload.id || requestCriteria.searchId || "";
  const checkInDate = payload.checkInDate || requestCriteria.checkInDate || "";
  const checkOutDate = payload.checkOutDate || requestCriteria.checkOutDate || "";

  let nights = requestCriteria.nights || 1;
  if (checkInDate && checkOutDate) {
    const d1 = new Date(checkInDate);
    const d2 = new Date(checkOutDate);
    const diffDays = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > 0) {
      nights = diffDays;
    }
  }

  const hotelMap = new Map<string, EnrichedHotelRate>();

  const keepBest = (rate: EnrichedHotelRate) => {
    const existing = hotelMap.get(rate.hotelId);
    if (!existing || rate.tieredMiles / rate.price > existing.tieredMiles / existing.price) {
      hotelMap.set(rate.hotelId, rate);
    }
  };

  const processHotelItem = (item: any) => {
    if (!item || typeof item !== "object") return;

    if (Array.isArray(item.pricing?.offers) || item.content?.informationSummary) {
      const agodaRate = extractAgodaProperty(item, {
        checkInDate: checkInDate || undefined,
        checkOutDate: checkOutDate || undefined,
        nights: requestCriteria.nights || nights,
        searchId: searchId || undefined,
      });
      if (agodaRate) keepBest(agodaRate);
      return;
    }

    const rawId = item.propertyId ?? item.hotelId ?? item.hotel?.id ?? item.id;
    if (rawId === null || rawId === undefined) return;
    const hotelId = String(rawId).trim();
    if (!hotelId) return;

    const hotelName =
      item.content?.informationSummary?.displayName ||
      item.displayName ||
      item.propertyName ||
      item.hotel?.name ||
      item.name ||
      "Unknown Hotel";
    const economics = item.economics || {};
    const pricing = item.pricing || {};

    let basePrice = 0;
    if (pricing.displayPrice?.amount) {
      basePrice = Number(pricing.displayPrice.amount);
    } else if (pricing.displayPrice?.exclusive?.amount) {
      basePrice = Number(pricing.displayPrice.exclusive.amount);
    } else if (pricing.totalPrice?.amount) {
      basePrice = Number(pricing.totalPrice.amount);
    } else if (pricing.price?.amount) {
      basePrice = Number(pricing.price.amount);
    } else if (item.displayPrice) {
      basePrice = Number(item.displayPrice);
    } else if (item.totalPrice?.amount) {
      basePrice = Number(item.totalPrice.amount);
    } else if (economics.total?.amount) {
      basePrice = Number(economics.total.amount);
    } else if (economics.displayPrice?.amount) {
      basePrice = Number(economics.displayPrice.amount);
    } else if (typeof item.price === "number") {
      basePrice = item.price;
    }

    const nightlyPrice = pricing.displayPrice?.perNight?.amount
      ? Number(pricing.displayPrice.perNight.amount)
      : economics.pricePerNight?.amount
      ? Number(economics.pricePerNight.amount)
      : 0;

    if (basePrice <= 0 && nightlyPrice > 0) {
      basePrice = nightlyPrice * nights;
    }

    let allInPrice =
      getAllInTotal(item) ||
      (pricing.displayPrice?.inclusive?.amount ? Number(pricing.displayPrice.inclusive.amount) : 0) ||
      (pricing.inclusive?.amount ? Number(pricing.inclusive.amount) : 0) ||
      (pricing.totalInclusive?.amount ? Number(pricing.totalInclusive.amount) : 0) ||
      (item.grandTotalPublishedPriceInclusive?.amount ? Number(item.grandTotalPublishedPriceInclusive.amount) : 0) ||
      (item.totalPriceInclusive?.amount ? Number(item.totalPriceInclusive.amount) : 0) ||
      (economics.totalInclusive?.amount ? Number(economics.totalInclusive.amount) : 0) ||
      basePrice;

    let fees = 0;
    if (typeof item.fees === "number") {
      fees = item.fees;
    } else if (item.fees?.amount) {
      fees = Number(item.fees.amount);
    }

    let baseMiles = 0;
    let tieredMiles = 0;

    if (item.loyaltyOfferSummary?.offers?.[0]?.earn?.points) {
      baseMiles = Number(item.loyaltyOfferSummary.offers[0].earn.points);
      tieredMiles = baseMiles;
    } else if (item.pointsMax?.points || item.pointsMax?.point) {
      baseMiles = Number(item.pointsMax.points || item.pointsMax.point);
      tieredMiles = baseMiles;
    } else if (pricing.pointmax?.point || pricing.pointmax?.points) {
      baseMiles = Number(pricing.pointmax.point || pricing.pointmax.points);
      tieredMiles = baseMiles;
    } else if (economics.rewardAmount || economics.rewardAmountTiered) {
      baseMiles = Number(economics.rewardAmount || economics.baseRewardAmount || 0);
      tieredMiles = Number(economics.rewardAmountTiered || economics.tieredRewardAmount || baseMiles);
    } else {
      baseMiles = Number(item.rewards ?? item.rewardAmount ?? item.rewardMiles ?? item.totalRewards ?? 0);
      tieredMiles = Number(item.rewardAmountTiered ?? baseMiles);
    }

    if (isNaN(basePrice)) basePrice = 0;
    if (isNaN(allInPrice) || allInPrice <= 0) allInPrice = basePrice;
    if (isNaN(baseMiles)) baseMiles = 0;
    if (isNaN(tieredMiles)) tieredMiles = baseMiles;

    if (allInPrice <= 0 && basePrice <= 0) return;
    if (baseMiles <= 0 && tieredMiles <= 0) return;

    // Location extraction & normalization
    const address = item.address || {};
    const city = normalizeCityName(address.city || "");
    const state = normalizeState(address.state || "");
    const location = getCanonicalLocation(city, state);
    const rawCountry =
      address.country?.name ||
      address.country?.code ||
      (typeof address.country === "string" ? address.country : "") ||
      address.countryCode ||
      "";
    let country = String(rawCountry).trim();
    if (/^(?:US|USA|United States)$/i.test(country) || (!country && (US_STATES[state.toLowerCase()] || /^[A-Z]{2}$/.test(state)))) {
      country = "United States";
    }

    const neighborhood =
      address.neighborhoodName ||
      item.neighborhoodName ||
      item.neighborhood ||
      "";
    const zipcode = address.zipcode || "";
    const latitude = address.latitude ?? item.latitude;
    const longitude = address.longitude ?? item.longitude;

    const stars = Number(item.stars ?? 0);
    const rating = Number(item.rating ?? 0);
    const reviewCount = Number(item.numberOfReviews ?? 0);
    const imageUrl = item.mainImage?.url ?? "";
    const refundable = item.isRefundable === true;

    const enrichedRate: EnrichedHotelRate = {
      hotelId,
      hotelName,
      price: allInPrice > 0 ? allInPrice : basePrice,
      basePrice,
      allInPrice,
      sitePriceTotals: getSitePriceTotals(item),
      nightlyPrice,
      fees,
      baseMiles,
      tieredMiles,
      city,
      state,
      location,
      country: country || undefined,
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

    keepBest(enrichedRate);
  };

  // 1. Check standard results array locations and GraphQL responses
  const candidates: any[] = [];
  if (Array.isArray(payload)) {
    candidates.push(...payload);
  }
  if (Array.isArray(payload.data?.search?.properties)) {
    candidates.push(...payload.data.search.properties);
  }
  if (Array.isArray(payload.data?.propertiesGql)) {
    candidates.push(...payload.data.propertiesGql);
  }
  // Agoda GraphQL: data.citySearch.properties, data.areaSearch.properties, ...
  if (payload.data && typeof payload.data === "object") {
    for (const key of Object.keys(payload.data)) {
      if (key === "search") continue;
      const properties = payload.data[key]?.properties;
      if (Array.isArray(properties)) {
        candidates.push(...properties);
      }
    }
  }
  if (Array.isArray(payload.data?.search?.hotelList)) {
    candidates.push(...payload.data.search.hotelList);
  }
  if (Array.isArray(payload.data?.propertyDetail?.rooms)) {
    const parentProp = payload.data.propertyDetail;
    const parentPropertyId = parentProp.propertyId ?? parentProp.id ?? parentProp.hotelId;
    const parentPropertyName = parentProp.propertyName ?? parentProp.displayName ?? parentProp.name;
    for (const room of parentProp.rooms) {
      candidates.push({
        ...room,
        propertyId: room.propertyId ?? parentPropertyId,
        displayName: room.displayName ?? room.name ?? parentPropertyName,
      });
    }
  }
  if (Array.isArray(payload.data?.properties)) {
    candidates.push(...payload.data.properties);
  }
  if (Array.isArray(payload.propertiesGql)) {
    candidates.push(...payload.propertiesGql);
  }
  if (Array.isArray(payload.properties)) {
    candidates.push(...payload.properties);
  }
  if (Array.isArray(payload.searchResult?.results)) {
    candidates.push(...payload.searchResult.results);
  }
  if (Array.isArray(payload.results)) {
    candidates.push(...payload.results);
  }

  candidates.forEach(processHotelItem);

  const rates = Array.from(hotelMap.values());
  const searchKey = requestBody ? getSearchKey(requestBody) : undefined;
  if (searchKey) rates.forEach((rate) => (rate.searchKey = searchKey));
  return rates;
}

export function isSensitiveCheckoutPage(url: string = typeof window !== 'undefined' ? window.location.href : ''): boolean {
  const lower = (url || '').toLowerCase();
  return (
    lower.includes('/checkout') ||
    lower.includes('/payment') ||
    lower.includes('/book') ||
    lower.includes('/booking')
  );
}

const positive = (value: unknown): number => {
  const amount = Number(value);
  return isFinite(amount) && amount > 0 ? amount : 0;
};

/**
 * Extracts room rates from the details page's room grid (the GetSecondaryData response):
 * roomGridData.masterRooms[].rooms[], with per-stay totals in pricing.displaySummary.perBook.
 */
export function extractRoomRatesFromPayload(payload: unknown): RoomRate[] {
  const masterRooms = field(field(payload, "roomGridData"), "masterRooms");
  if (!Array.isArray(masterRooms)) return [];
  const nights = positive(field(field(payload, "hotelSearchCriteria"), "los")) || 1;

  const rooms: RoomRate[] = [];
  for (const master of masterRooms) {
    const rates = field(master, "rooms");
    if (!Array.isArray(rates)) continue;
    for (const rate of rates) {
      const roomId = field(rate, "roomIdentifiers");
      // Miles per dollar is only meaningful for USD prices
      if (typeof roomId !== "string" || !roomId || field(rate, "currency") !== "USD") continue;

      const perBook = field(field(field(rate, "pricing"), "displaySummary"), "perBook");
      const total = (key: string, kind: "allInclusive" | "exclusive") => positive(field(field(perBook, key), kind));
      // Room + taxes + every fee, including those paid at the property (payAtHotel)
      const allInPrice = total("displayTotal", "allInclusive");
      if (!allInPrice) continue;

      rooms.push({
        roomId,
        allInPrice,
        // Without taxes, or without the fees paid at the property
        sitePriceTotals: [total("displayTotal", "exclusive"), total("payToAgoda", "allInclusive")].filter(
          (amount, i, all) => amount > 0 && amount !== allInPrice && all.indexOf(amount) === i
        ),
        nights,
      });
    }
  }
  return rooms;
}

export function dispatchInterceptedRooms(rooms: RoomRate[]): void {
  if (!rooms || rooms.length === 0 || typeof window === "undefined") return;
  try {
    try {
      sessionStorage.setItem("aa_hotels_latest_rooms", JSON.stringify(rooms));
    } catch {
      // Ignore quota or security errors
    }
    window.postMessage({ type: EVENT_NAME, rooms }, "*");
  } catch (err) {
    console.debug("[AA-Hotels-MPD] Failed to dispatch room rates:", err);
  }
}

export function shouldInspectUrl(url: string): boolean {
  if (!url) return false;
  if (isSensitiveCheckoutPage(url) || (typeof window !== 'undefined' && isSensitiveCheckoutPage(window.location.href))) {
    return false;
  }
  // Match on the path only: the host itself (https://search.aadvantagehotels.com) contains "/search"
  let lower = url.toLowerCase();
  try {
    const base = typeof window !== 'undefined' ? window.location.href : 'https://search.aadvantagehotels.com/';
    lower = new URL(url, base).pathname.toLowerCase();
  } catch {
    // Fall back to the raw string
  }
  return (
    lower.includes("/graphql") ||
    lower.includes("/search") ||
    lower.includes("/accom") ||
    lower.includes("/property")
  );
}

const WRAPPED = Symbol.for("aa-hotels-mpd.wrappedFetch");
const tappedResponses = new WeakSet<Response>();

function inspectPayload(url: string, method: string, data: unknown, requestBody?: unknown): void {
  try {
    if (networkRecorder) {
      try {
        networkRecorder(url, method, data, requestBody);
      } catch {
        // Debug recording is best effort
      }
    }
    const totalHotels = extractTotalFilteredHotels(data);
    const searchKey = requestBody ? getSearchKey(requestBody) : undefined;
    dispatchInterceptedRates(
      extractHotelRatesFromPayload(data, requestBody),
      totalHotels,
      searchKey,
      isFinalAvailabilityPoll(requestBody)
    );
    dispatchInterceptedRooms(extractRoomRatesFromPayload(data));
  } catch {
    // Ignore inspection errors to never interfere with page functionality
  }
}

/**
 * Taps the response's own json()/text() so the payload is inspected when the page reads it.
 * Reading a clone instead doesn't work: the site aborts each GraphQL request after reading the
 * body, which errors any clone that hasn't been consumed yet.
 */
function tapResponse(response: Response, url: string, requestBody?: unknown): void {
  if (tappedResponses.has(response)) return;
  tappedResponses.add(response);

  const originalJson = response.json;
  response.json = function (this: Response) {
    return originalJson.call(this).then((data: unknown) => {
      inspectPayload(url, "FETCH", data, requestBody);
      return data;
    });
  };

  const originalText = response.text;
  response.text = function (this: Response) {
    return originalText.call(this).then((text: string) => {
      const trimmed = text.replace(/^\s+/, "");
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          inspectPayload(url, "FETCH", JSON.parse(text), requestBody);
        } catch {
          // Not JSON after all
        }
      }
      return text;
    });
  };
}

export function serializeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  try {
    if (typeof (headers as any).forEach === "function") {
      (headers as Headers).forEach((value, key) => {
        result[key.toLowerCase()] = value;
      });
    } else if (Array.isArray(headers)) {
      headers.forEach(([key, value]) => {
        result[key.toLowerCase()] = value;
      });
    } else if (typeof headers === "object") {
      for (const k of Object.keys(headers)) {
        result[k.toLowerCase()] = String((headers as Record<string, any>)[k]);
      }
    }
  } catch {}
  return result;
}

export function isSearchQuery(url: string, body: unknown): boolean {
  if (!body) return false;
  let parsed: any = body;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return false;
    }
  }
  if (!parsed || typeof parsed !== "object") return false;
  const opName = String(parsed.operationName || "").toLowerCase();
  if (opName.includes("search")) return true;
  if (parsed.variables) {
    for (const key of Object.keys(parsed.variables)) {
      if (key.toLowerCase().includes("search") && parsed.variables[key]?.searchRequest?.page) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Wraps a fetch implementation so JSON responses from search/property endpoints are inspected.
 */
export function wrapFetch(originalFetch: typeof fetch): typeof fetch {
  if ((originalFetch as any)[WRAPPED]) return originalFetch;
  const wrapped = async function (
    this: unknown,
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
        tapResponse(response, url, init?.body);
        const reqHeaders = serializeHeaders(init?.headers);
        if (
          isSearchQuery(url, init?.body) &&
          !reqHeaders["x-aa-mpd-background"] &&
          typeof window !== "undefined"
        ) {
          try {
            window.postMessage(
              {
                type: "AA_HOTELS_CAPTURED_SEARCH_REQUEST",
                url,
                headers: reqHeaders,
                body: init?.body,
              },
              "*"
            );
          } catch {}
        }
      }
    } catch {
      // Ignore inspection errors to never interfere with page functionality
    }
    return response;
  };
  Object.defineProperty(wrapped, WRAPPED, { value: true });
  return wrapped as typeof fetch;
}

/**
 * Initializes monkey-patching on window.fetch and XMLHttpRequest.
 * Only runs once.
 */
let isInitialized = false;

export function initNetworkInterceptor(): void {
  if (isInitialized || typeof window === "undefined") return;
  if (isSensitiveCheckoutPage(window.location.href)) return;
  isInitialized = true;

  // Must run before the site creates its IntersectionObservers
  initListExpander();

  // 1. Monkey-patch window.fetch. The site reassigns window.fetch after load (with a bound
  // native fetch), so the property is redefined with a setter that wraps whatever is assigned.
  if (typeof window.fetch === "function") {
    let currentFetch = wrapFetch(window.fetch);
    try {
      Object.defineProperty(window, "fetch", {
        configurable: true,
        enumerable: true,
        get: () => currentFetch,
        set: (value: typeof fetch) => {
          currentFetch = typeof value === "function" ? wrapFetch(value) : value;
        },
      });
    } catch {
      window.fetch = currentFetch;
    }
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
      const requestBody = typeof body === "string" ? body : undefined;
      const self = this;
      this.addEventListener("load", function () {
        try {
          const url = (self as any)._aaMpdUrl || "";
          if (shouldInspectUrl(url)) {
            const text = self.responseText;
            if (text && (text.startsWith("{") || text.startsWith("["))) {
              inspectPayload(url, "XHR", JSON.parse(text), requestBody);
            }
            if (
              isSearchQuery(url, requestBody) &&
              typeof window !== "undefined"
            ) {
              window.postMessage(
                {
                  type: "AA_HOTELS_CAPTURED_SEARCH_REQUEST",
                  url,
                  headers: {},
                  body: requestBody,
                },
                "*"
              );
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
