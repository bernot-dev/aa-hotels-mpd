// Shared Hotel MPD Registry and DOM ID extraction helpers

export const hotelMpdRegistry = new Map<string, number>();
const STORAGE_KEY = "aa_hotels_mpd_registry";

// Initialize from sessionStorage if available
try {
  if (typeof sessionStorage !== "undefined") {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        for (const id of Object.keys(parsed)) {
          const mpd = (parsed as Record<string, number>)[id];
          if (typeof mpd === "number" && mpd > 0) {
            hotelMpdRegistry.set(id, mpd);
          }
        }
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
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    }
  } catch {
    // Ignore storage write errors
  }
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

export function clearHotelMpdRegistry(): void {
  hotelMpdRegistry.clear();
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(STORAGE_KEY);
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
