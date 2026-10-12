// Map View Controller, Pin Color Normalization & Property Preview MPD

import { processCard, innermostCards, CARD_SELECTOR } from "./cards";
import { DEFAULT_EARNING_LEVEL, EarningLevel } from "./settings";
import {
  hotelMpdRegistry,
  registerHotelMPD,
  getHotelMPD,
  clearHotelMpdRegistry,
  getHotelIdFromPin,
  getHotelIdFromCard,
  getEnrichedHotel,
  MPD_FAIR,
  MPD_GOOD,
} from "./registry";
import { applyAllInPrice, candidatesFromHotel } from "./allin";
import { getLogoUrl } from "./logo";

export {
  hotelMpdRegistry,
  registerHotelMPD,
  getHotelMPD,
  clearHotelMpdRegistry,
  getHotelIdFromPin,
  getHotelIdFromCard,
};

/**
 * Pin color for a rate, using the same fixed thresholds as the chips' MPD dots: red under
 * MPD_FAIR, amber up to MPD_GOOD, green at MPD_GOOD and above. Each has high contrast (>4.5:1 WCAG
 * AA) against bold white text.
 */
export function getPinColor(mpd: number): string {
  if (mpd >= MPD_GOOD) return "rgb(21, 128, 61)";
  if (mpd >= MPD_FAIR) return "rgb(217, 119, 6)";
  return "rgb(185, 28, 28)";
}

export const PIN_SELECTOR =
  '[data-element-name="map-search-property-marker"], [data-selenium^="propertyMarkerIcon-"], button[data-selenium*="pin"], [data-selenium*="pin"], [class*="map-pin"]';

/**
 * Colors visible map pins by their MPD rating, and shows all-in prices when enabled.
 */
export function updateMapPins(root: Element = document.body, useAllInPricing: boolean = true): void {
  const pins = root.querySelectorAll<HTMLElement>(PIN_SELECTOR);
  if (pins.length === 0) return;

  if (useAllInPricing) {
    pins.forEach((pin) => {
      const hotelId = getHotelIdFromPin(pin);
      if (hotelId) {
        applyAllInPrice(pin.querySelector("span") || pin, candidatesFromHotel(getEnrichedHotel(hotelId)));
      }
    });
  }

  pins.forEach((pin) => {
    const hotelId = getHotelIdFromPin(pin);
    const mpd = hotelId ? hotelMpdRegistry.get(hotelId) : undefined;
    if (!mpd) return;
    const color = getPinColor(mpd);

    // Agoda markers draw their bubble on an inner content element
    const bubble = pin.querySelector<HTMLElement>(".propertyMarkerIcon-content") || pin;
    bubble.style.setProperty("background", color, "important");
    bubble.style.setProperty("background-color", color, "important");
    bubble.style.setProperty("border-color", color, "important");
    bubble.style.setProperty("color", "#ffffff", "important");
    bubble.style.setProperty("font-weight", "bold", "important");
    pin.setAttribute("data-aa-mpd", mpd.toFixed(1));
    const span = bubble.querySelector("span");
    if (span) {
      span.style.setProperty("color", "#ffffff", "important");
      span.style.setProperty("font-weight", "bold", "important");
    }
    const price = pin.textContent?.trim() || "";
    pin.title = `${mpd.toFixed(1)} miles/$ (${price})`;
  });
}

export const POPUP_RATE_CLASS = "aa-mpd-popup-rate";

// The preview has a fixed height, so the rate goes in the star rating row (12px tall plus a 6px
// margin), which keeps the guest rating below it in place
const STAR_ROW_STYLES: Record<string, string> = {
  display: "flex",
  "align-items": "center",
  gap: "6px",
  height: "18px",
  "margin-bottom": "0px",
};

function setStarRowLayout(starRow: HTMLElement, on: boolean): void {
  Object.keys(STAR_ROW_STYLES).forEach((prop) => {
    if (on) starRow.style.setProperty(prop, STAR_ROW_STYLES[prop]);
    else starRow.style.removeProperty(prop);
  });
}

function createPopupRate(): HTMLElement {
  const rate = document.createElement("span");
  rate.className = POPUP_RATE_CLASS;
  rate.dataset.aaMpd = "true";
  Object.assign(rate.style, {
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    height: "18px",
    fontSize: "12px",
    fontWeight: "600",
    lineHeight: "14px",
    color: "#0f172a",
    whiteSpace: "nowrap",
  });
  const logo = document.createElement("img");
  logo.src = getLogoUrl(32);
  logo.alt = "";
  logo.setAttribute("aria-hidden", "true");
  logo.width = 14;
  logo.height = 14;
  rate.append(logo, document.createElement("span"));
  return rate;
}

/**
 * Shows each hotel's MPD (the same rate that colors its pin) between the name and the guest rating
 * in the preview the site opens when hovering a map pin.
 */
export function updateMapPopups(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>(".propertyMarkerPopup-popup[data-hotelid]").forEach((popup) => {
    const mpd = hotelMpdRegistry.get(popup.dataset.hotelid || "");
    const name = popup.querySelector(".hotelName-container");
    const starRow = popup.querySelector<HTMLElement>(".rating-container");
    let rate = popup.querySelector<HTMLElement>(`.${POPUP_RATE_CLASS}`);
    if (!mpd || !name) {
      rate?.remove();
      if (starRow) setStarRowLayout(starRow, false);
      return;
    }

    rate = rate || createPopupRate();
    if (starRow) {
      setStarRowLayout(starRow, true);
      if (rate.parentElement !== starRow || rate.nextSibling) starRow.appendChild(rate);
    } else if (rate.previousElementSibling !== name) {
      // No star rating row: the rate takes its place under the name
      name.insertAdjacentElement("afterend", rate);
    }
    rate.style.display = starRow ? "inline-flex" : "flex";

    const text = `${mpd.toFixed(1)} mpd`;
    const label = rate.querySelector("span")!;
    if (label.textContent !== text) label.textContent = text;
    const title = `${mpd.toFixed(1)} miles per dollar`;
    if (rate.title !== title) rate.title = title;
  });
}

/**
 * Processes any property preview cards mounted inside the map view.
 */
export function processMapPreviewCards(
  root: Element = document.body,
  nights: number = 1,
  includeBonusMiles: boolean = false,
  useAllInPricing: boolean = true,
  earningLevel: EarningLevel = DEFAULT_EARNING_LEVEL
): void {
  const previewCards = innermostCards(root.querySelectorAll(CARD_SELECTOR));

  let newRatesFound = false;

  previewCards.forEach((elem) => {
    const card = elem;
    if (!card) return;

    const { cardMaxMPD } = processCard(card, nights, includeBonusMiles, useAllInPricing, true, earningLevel);

    if (cardMaxMPD > 0) {
      const hotelId = getHotelIdFromCard(card);
      if (hotelId) {
        const prev = hotelMpdRegistry.get(hotelId) || 0;
        if (cardMaxMPD > prev) {
          hotelMpdRegistry.set(hotelId, cardMaxMPD);
          newRatesFound = true;
        }
      }
    }
  });

  if (newRatesFound) {
    updateMapPins(root, useAllInPricing);
  }
}
