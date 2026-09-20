import { SearchCriteria } from "../types";
import { getNights } from "../nights";

const US_STATES_MAP: Record<string, string> = {
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

export function normalizeLocation(raw: string | undefined | null): string {
  if (!raw) return "";
  let loc = raw.trim();
  if (loc.length < 3 || loc.toLowerCase() === "unknown location") return "";

  // 1. Match paren state pattern e.g. "Las Vegas (NV), US", "Flagstaff (AZ)", "Las Vegas (NV)"
  const parenMatch = loc.match(
    /^([^(]+?)\s*\(([A-Za-z]{2})\)(?:,\s*(?:US|USA|United States|[A-Za-z\s]+))?$/i
  );
  if (parenMatch) {
    const city = parenMatch[1].trim();
    const st = parenMatch[2].toUpperCase();
    return `${city}, ${st}`;
  }

  // 2. Strip trailing country e.g. ", US", ", USA", ", United States"
  loc = loc.replace(/,\s*(?:US|USA|United States)$/i, "").trim();

  // 3. Known neighborhood aliases mapped to canonical city/state
  if (/^The Strip$/i.test(loc) || /^Lake Las Vegas$/i.test(loc)) {
    return "Las Vegas, NV";
  }
  if (/^Boulder City$/i.test(loc)) {
    return "Boulder City, NV";
  }

  // 4. "City, State" e.g. "Dallas, Texas" -> "Dallas, TX"
  const commaParts = loc.split(",").map((s) => s.trim());
  if (commaParts.length === 2) {
    const city = commaParts[0];
    const stateRaw = commaParts[1].toLowerCase().replace(/\s+state$/i, "").trim();
    if (stateRaw.length === 2 && /^[a-z]{2}$/i.test(stateRaw)) {
      return `${city}, ${stateRaw.toUpperCase()}`;
    }
    if (US_STATES_MAP[stateRaw]) {
      return `${city}, ${US_STATES_MAP[stateRaw]}`;
    }
  }

  return loc;
}

export function isValidLocation(location: string | undefined | null): boolean {
  if (!location) return false;
  const trimmed = location.trim();
  if (trimmed.length < 3) return false;
  if (trimmed.toLowerCase() === "unknown location") return false;
  if (
    /^(?:Southside Neighborhood|Black Bill Park|Flagstaff City Center)$/i.test(
      trimmed
    )
  ) {
    return false;
  }
  return true;
}

export function extractSearchCriteria(
  currentUrl: string = typeof window !== "undefined" ? window.location.href : "",
  doc: Document = typeof document !== "undefined" ? document : (null as unknown as Document)
): SearchCriteria {
  let location = "Unknown Location";
  let checkIn = "";
  let checkOut = "";
  let rooms = 1;
  let guests = 2;

  // 1. Try URL parameters first
  if (currentUrl) {
    try {
      const url = new URL(currentUrl, "https://www.aadvantagehotels.com");
      const destParam =
        url.searchParams.get("destination") ||
        url.searchParams.get("city") ||
        url.searchParams.get("location") ||
        url.searchParams.get("dest") ||
        url.searchParams.get("q") ||
        url.searchParams.get("place");
      if (destParam && destParam.trim()) {
        const decoded = decodeURIComponent(destParam.trim().replace(/\+/g, " "));
        if (isValidLocation(decoded)) {
          location = decoded;
        }
      }

      const inParam = url.searchParams.get("checkIn") || url.searchParams.get("checkin");
      if (inParam) {
        checkIn = inParam;
      }

      const outParam = url.searchParams.get("checkOut") || url.searchParams.get("checkout");
      if (outParam) {
        checkOut = outParam;
      }

      const roomsParam = url.searchParams.get("rooms");
      if (roomsParam && !isNaN(Number(roomsParam)) && Number(roomsParam) > 0) {
        rooms = parseInt(roomsParam, 10);
      }

      const adultsParam = url.searchParams.get("adults");
      const childrenParam = url.searchParams.get("children") || "0";
      const totalAdults = adultsParam ? parseInt(adultsParam, 10) : 0;
      const totalChildren = parseInt(childrenParam, 10) || 0;
      if (totalAdults > 0) {
        guests = totalAdults + totalChildren;
      }
    } catch {
      // Ignore URL parse errors
    }
  }

  // 2. DOM extraction: card details links across the entire document
  // (authoritative source for currently displayed cards on search page)
  if (doc) {
    const cardLinks = doc.querySelectorAll<HTMLAnchorElement>(
      'a[href*="/details"], a[href*="destination="], [data-testid^="hotel-card-"] a, a[href*="id="]'
    );
    for (const link of Array.from(cardLinks)) {
      if (!link.href) continue;
      try {
        const cardUrl = new URL(link.href, "https://www.aadvantagehotels.com");
        if (location === "Unknown Location") {
          const dest =
            cardUrl.searchParams.get("destination") ||
            cardUrl.searchParams.get("city") ||
            cardUrl.searchParams.get("location") ||
            cardUrl.searchParams.get("dest") ||
            cardUrl.searchParams.get("q");
          if (dest && dest.trim()) {
            const decoded = decodeURIComponent(dest.trim().replace(/\+/g, " "));
            if (isValidLocation(decoded)) {
              location = decoded;
            }
          }
        }
        if (!checkIn) {
          const inParam = cardUrl.searchParams.get("checkIn") || cardUrl.searchParams.get("checkin");
          if (inParam) checkIn = inParam;
        }
        if (!checkOut) {
          const outParam = cardUrl.searchParams.get("checkOut") || cardUrl.searchParams.get("checkout");
          if (outParam) checkOut = outParam;
        }
        if (rooms === 1) {
          const roomsParam = cardUrl.searchParams.get("rooms");
          if (roomsParam && !isNaN(Number(roomsParam)) && Number(roomsParam) > 0) {
            rooms = parseInt(roomsParam, 10);
          }
        }
        if (guests === 2) {
          const adultsParam = cardUrl.searchParams.get("adults");
          const childrenParam = cardUrl.searchParams.get("children") || "0";
          const totalAdults = adultsParam ? parseInt(adultsParam, 10) : 0;
          const totalChildren = parseInt(childrenParam, 10) || 0;
          if (totalAdults > 0) {
            guests = totalAdults + totalChildren;
          }
        }
        if (location !== "Unknown Location" && checkIn && checkOut) {
          break;
        }
      } catch {}
    }
  }

  // 3. Search page DOM extraction: neighborhood filter container
  if (location === "Unknown Location" && doc) {
    const nFilter = doc.querySelector('[data-testid="neighborhood-filter-container"]');
    if (nFilter) {
      const nLabels = Array.from(
        nFilter.querySelectorAll('.chakra-checkbox__label p, label p, span p')
      )
        .map((el) => el.textContent?.trim() || "")
        .filter(isValidLocation);
      if (nLabels.length > 0) {
        location = nLabels[0];
      }
    }
  }

  // 4. Search page DOM extraction: hotel card neighborhoods
  if (location === "Unknown Location" && doc) {
    const cardNeighborhoods = Array.from(
      doc.querySelectorAll('[data-testid="hotel-neighborhood"]')
    )
      .map((el) => el.textContent?.trim() || "")
      .filter(isValidLocation);
    if (cardNeighborhoods.length > 0) {
      location = cardNeighborhoods[0];
    }
  }

  // 5. Document title (e.g. "Hotels in Dallas, TX" or "Dallas Hotels")
  if (location === "Unknown Location" && doc && doc.title) {
    const titleMatch =
      doc.title.match(/Hotels\s+in\s+([^|\-]+)/i) ||
      doc.title.match(/^([^|\-]+?)\s+Hotels/i);
    if (titleMatch && isValidLocation(titleMatch[1].trim())) {
      location = titleMatch[1].trim();
    }
  }

  // 6. Search page DOM extraction: hotel name city pattern (e.g. "Hilton Anatole, Dallas" -> "Dallas")
  if (location === "Unknown Location" && doc) {
    const hotelNames = Array.from(
      doc.querySelectorAll('[data-testid="hotel-name"]')
    ).map((el) => el.textContent?.trim() || "");
    for (const name of hotelNames) {
      const cityMatch = name.match(/,\s*([^,]+)$/);
      if (cityMatch && isValidLocation(cityMatch[1].trim())) {
        location = cityMatch[1].trim();
        break;
      }
    }
  }

  // 7. DOM extraction: hotel address on details page
  if (location === "Unknown Location" && doc) {
    const cityEl = doc.querySelector('[data-testid="address-city"]');
    const countryEl = doc.querySelector('[data-testid="address-country"]');
    if (cityEl && cityEl.textContent?.trim()) {
      const city = cityEl.textContent.trim();
      const country = countryEl?.textContent?.trim();
      const addrLoc = country ? `${city}, ${country}` : city;
      if (isValidLocation(addrLoc)) {
        location = addrLoc;
      }
    }
  }

  // NOTE: Destination input box is NEVER read under any circumstances.
  // Location is sourced strictly from encoded links, neighborhood filters, or page elements.

  if (doc) {
    if (!checkIn) {
      const inInput = doc.querySelector<HTMLInputElement>("#check-in-date");
      if (inInput && inInput.value) {
        checkIn = inInput.value;
      }
    }

    if (!checkOut) {
      const outInput = doc.querySelector<HTMLInputElement>("#check-out-date");
      if (outInput && outInput.value) {
        checkOut = outInput.value;
      }
    }

    // Rooms & Guests fallback from button text
    const roomsGuestsBtn = doc.querySelector('[data-testid="search-rooms-and-guests-button"]');
    if (roomsGuestsBtn && roomsGuestsBtn.textContent) {
      const text = roomsGuestsBtn.textContent;
      const roomsMatch = text.match(/(\d+)\s*Room/i);
      if (roomsMatch) {
        rooms = parseInt(roomsMatch[1], 10);
      }
      const guestsMatch = text.match(/(\d+)\s*Guest/i);
      if (guestsMatch) {
        guests = parseInt(guestsMatch[1], 10);
      }
    }
  }

  // Calculate nights
  let nights = getNights();
  if (checkIn && checkOut) {
    const inMs = Date.parse(checkIn);
    const outMs = Date.parse(checkOut);
    if (!isNaN(inMs) && !isNaN(outMs)) {
      const diffDays = Math.round((outMs - inMs) / (1000 * 60 * 60 * 24));
      if (diffDays > 0) {
        nights = diffDays;
      }
    }
  }

  if (!checkIn) {
    const today = new Date();
    checkIn = today.toISOString().split("T")[0];
  }
  if (!checkOut) {
    const tomorrow = new Date(Date.now() + 86400000);
    checkOut = tomorrow.toISOString().split("T")[0];
  }

  return {
    location,
    checkIn,
    checkOut,
    nights: nights || 1,
    rooms: rooms || 1,
    guests: guests || 2,
    timestamp: new Date().toISOString(),
    url: currentUrl,
  };
}
