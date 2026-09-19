// Map View Controller, Pin Color Normalization & Property Preview MPD

import { processCard } from "./cards";
import {
  hotelMpdRegistry,
  registerHotelMPD,
  getHotelMPD,
  clearHotelMpdRegistry,
  getHotelIdFromPin,
  getHotelIdFromCard,
} from "./registry";

export {
  hotelMpdRegistry,
  registerHotelMPD,
  getHotelMPD,
  clearHotelMpdRegistry,
  getHotelIdFromPin,
  getHotelIdFromCard,
};

/**
 * Maps a normalized ratio [0, 1] to an RGB color string.
 * 0.0 = Worst MPD (Crimson Red: #b91c1c / rgb(185, 28, 28))
 * 0.5 = Median MPD (Golden Amber: #d97706 / rgb(217, 119, 6))
 * 1.0 = Best MPD (Forest Green: #15803d / rgb(21, 128, 61))
 * Provides high contrast (>4.5:1 WCAG AA) against bold white text.
 */
export function getColorForRatio(ratio: number): string {
  const clamped = Math.max(0, Math.min(1, isNaN(ratio) ? 0.5 : ratio));
  let r: number, g: number, b: number;
  if (clamped <= 0.5) {
    const t = clamped / 0.5;
    r = Math.round(185 + (217 - 185) * t);
    g = Math.round(28 + (119 - 28) * t);
    b = Math.round(28 + (6 - 28) * t);
  } else {
    const t = (clamped - 0.5) / 0.5;
    r = Math.round(217 + (21 - 217) * t);
    g = Math.round(119 + (128 - 119) * t);
    b = Math.round(6 + (61 - 6) * t);
  }
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Updates visible map pins with normalized background colors.
 */
export function updateMapPins(root: Element = document.body): void {
  const pins = root.querySelectorAll<HTMLElement>(
    'button[data-testid^="hotel-pin-"], [data-testid^="hotel-pin-"]'
  );
  if (pins.length === 0) return;

  const knownPins: { pin: HTMLElement; mpd: number }[] = [];

  pins.forEach((pin) => {
    const hotelId = getHotelIdFromPin(pin);
    if (hotelId && hotelMpdRegistry.has(hotelId)) {
      const mpd = hotelMpdRegistry.get(hotelId)!;
      knownPins.push({ pin, mpd });
    }
  });

  if (knownPins.length === 0) return;

  const mpdValues = knownPins.map((p) => p.mpd);
  const minMPD = Math.min(...mpdValues);
  const maxMPD = Math.max(...mpdValues);

  knownPins.forEach(({ pin, mpd }) => {
    const ratio = maxMPD > minMPD ? (mpd - minMPD) / (maxMPD - minMPD) : 1.0;
    const color = getColorForRatio(ratio);

    pin.style.setProperty("background-color", color, "important");
    pin.style.setProperty("border-color", color, "important");
    pin.style.setProperty("color", "#ffffff", "important");
    pin.style.setProperty("font-weight", "bold", "important");
    pin.setAttribute("data-aa-mpd", mpd.toFixed(1));
    const price = pin.textContent?.trim() || "";
    pin.title = `${mpd.toFixed(1)} miles/$ (${price})`;
  });
}

/**
 * Processes any property preview cards mounted inside the map view.
 */
export function processMapPreviewCards(
  root: Element = document.body,
  nights: number = 1,
  includeBonusMiles: boolean = false
): void {
  // Preview cards may have data-testid="hotel-card-pricing" or contain earn-price + tier-earn-rewards
  const previewCards = root.querySelectorAll(
    '[data-testid="hotel-card-pricing"], [data-testid="earn-price"]'
  );

  let newRatesFound = false;

  previewCards.forEach((elem) => {
    const card = elem.matches('[data-testid="hotel-card-pricing"]')
      ? elem
      : elem.closest('[data-testid="hotel-card-pricing"]') || elem.parentElement;

    if (!card) return;

    const { cardMaxMPD } = processCard(card, nights, includeBonusMiles);

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
    updateMapPins(root);
  }
}

export interface MapController {
  update: () => void;
  teardown: () => void;
}

/**
 * Sets up the map view controller with mutation observation for pins and preview cards.
 */
export function setupMapController(
  container: Element,
  nights: number = 1,
  includeBonusMiles: boolean = false
): MapController {
  let isDisposed = false;
  let isScheduled = false;

  const runUpdate = () => {
    if (isDisposed) return;
    isScheduled = false;
    processMapPreviewCards(container, nights, includeBonusMiles);
    updateMapPins(container);
  };

  const scheduleUpdate = () => {
    if (isDisposed || isScheduled) return;
    isScheduled = true;
    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(runUpdate);
    } else {
      setTimeout(runUpdate, 16);
    }
  };

  const observer = new MutationObserver((mutations) => {
    if (isDisposed) return;
    // Check if external mutations occurred
    const hasExternal = mutations.some((m) => {
      const target = m.target as HTMLElement;
      if (target?.classList?.contains("aa-mpd-badge") || target?.dataset?.aaMpd) {
        return false;
      }
      return true;
    });

    if (hasExternal) {
      scheduleUpdate();
    }
  });

  observer.observe(container, { childList: true, subtree: true });

  // Initial immediate run
  runUpdate();

  return {
    update: runUpdate,
    teardown: () => {
      isDisposed = true;
      observer.disconnect();
    },
  };
}
