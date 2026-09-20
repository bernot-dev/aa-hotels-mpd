import { SearchCriteria } from "../types";
import { getNights } from "../nights";

export function isValidLocation(location: string | undefined | null): boolean {
  if (!location) return false;
  const trimmed = location.trim();
  if (trimmed.length < 3) return false;
  if (trimmed.toLowerCase() === "unknown location") return false;
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
      const destParam = url.searchParams.get("destination");
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

  // 2. DOM extraction: card links (ground truth for currently displayed cards on search page)
  if (location === "Unknown Location" && doc) {
    const cardLink = doc.querySelector<HTMLAnchorElement>(
      'a[href*="/details"][href*="destination="], a[href*="destination="]'
    );
    if (cardLink && cardLink.href) {
      try {
        const cardUrl = new URL(cardLink.href, "https://www.aadvantagehotels.com");
        const dest = cardUrl.searchParams.get("destination");
        if (dest && dest.trim()) {
          const decoded = decodeURIComponent(dest.trim().replace(/\+/g, " "));
          if (isValidLocation(decoded)) {
            location = decoded;
          }
        }
      } catch {}
    }
  }

  // 3. DOM extraction: hotel address on details page
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

  // 4. Safe input fallback ONLY when:
  // - location is still Unknown Location
  // - user is NOT currently focusing or typing in the input
  // - autocomplete dropdown menu is NOT open (aria-expanded !== "true")
  // - value is a valid, non-partial location (isValidLocation(val))
  if (location === "Unknown Location" && doc) {
    const destInput = doc.querySelector<HTMLInputElement>(
      '[data-testid="search-destination"], #downshift-0-input'
    );
    if (destInput && destInput.value) {
      const val = destInput.value.trim();
      const isFocused = doc.activeElement === destInput;
      const isExpanded = destInput.getAttribute("aria-expanded") === "true";
      if (!isFocused && !isExpanded && isValidLocation(val)) {
        location = val;
      }
    }
  }

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
