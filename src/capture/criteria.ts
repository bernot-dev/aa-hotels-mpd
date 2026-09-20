import { SearchCriteria } from "../types";
import { getNights } from "../nights";

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
        location = decodeURIComponent(destParam.trim());
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

  // 2. DOM fallbacks
  if (doc) {
    if (location === "Unknown Location") {
      const destInput = doc.querySelector<HTMLInputElement>(
        '[data-testid="search-destination"], #downshift-0-input'
      );
      if (destInput && destInput.value && destInput.value.trim()) {
        location = destInput.value.trim();
      }
    }

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
