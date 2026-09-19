// Shared Hotel MPD Registry and DOM ID extraction helpers

export const hotelMpdRegistry = new Map<string, number>();

export function registerHotelMPD(hotelId: string, mpd: number): void {
  if (!hotelId || isNaN(mpd) || !isFinite(mpd) || mpd <= 0) return;
  const current = hotelMpdRegistry.get(hotelId) || 0;
  if (mpd > current) {
    hotelMpdRegistry.set(hotelId, mpd);
  }
}

export function getHotelMPD(hotelId: string): number | undefined {
  return hotelMpdRegistry.get(hotelId);
}

export function clearHotelMpdRegistry(): void {
  hotelMpdRegistry.clear();
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
