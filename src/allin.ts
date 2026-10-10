// All-in price display: when the user's Price Calculation Method is "All-In", swap the prices the
// site shows (search cards, map pins and previews, details room rates) for the total with taxes and
// every fee, and relabel "includes fees" to "includes taxes and fees".
//
// The site picks which total to show by jurisdiction (California already shows all-in prices), so a
// price is only replaced when it is recognizably one of the site's other totals. A price that already
// matches the all-in total, or that can't be identified, is left exactly as the site rendered it.

import type { EnrichedHotelRate, RoomRate } from "./interceptor";

export const ALL_IN_LABEL = "includes taxes and fees";
const FEES_LABEL = /^includes fees$/i;
const REPLACED_ATTR = "data-aa-mpd-all-in";
// The site rounds to whole dollars
const TOLERANCE = 1;

export interface AllInCandidates {
  allInPrice: number;
  sitePriceTotals: number[];
  nights: number;
}

const roomRates = new Map<string, RoomRate>();

export function ingestRoomRates(rooms: RoomRate[]): void {
  rooms.forEach((room) => {
    if (!room?.roomId || !(room.allInPrice > 0)) return;
    roomRates.set(room.roomId, { ...room, sitePriceTotals: room.sitePriceTotals || [] });
  });
}

export function clearRoomRates(): void {
  roomRates.clear();
}

const matches = (shown: number, amount: number) => Math.abs(shown - Math.round(amount)) <= TOLERANCE;

/**
 * The amount an element showing `shown` should display instead, or null to leave it alone: when it
 * already shows the all-in total (per stay or per night), or isn't one of the site's known totals.
 */
export function resolveAllInAmount(shown: number, candidates: AllInCandidates): number | null {
  const { allInPrice, sitePriceTotals } = candidates;
  if (!(shown > 0) || !(allInPrice > 0)) return null;
  const nights = candidates.nights > 0 ? candidates.nights : 1;

  if (matches(shown, allInPrice) || (nights > 1 && matches(shown, allInPrice / nights))) return null;

  for (const total of sitePriceTotals || []) {
    if (!(total > 0)) continue;
    if (matches(shown, total)) return allInPrice;
    if (nights > 1 && matches(shown, total / nights)) return allInPrice / nights;
  }
  return null;
}

export function candidatesFromHotel(hotel: EnrichedHotelRate | undefined): AllInCandidates | null {
  if (!hotel || !(hotel.allInPrice > 0)) return null;
  return {
    allInPrice: hotel.allInPrice,
    sitePriceTotals: hotel.sitePriceTotals || [],
    nights: hotel.nights || 1,
  };
}

/** A details room card's rate, found by the room identifier the card carries. */
export function candidatesFromRoom(card: Element): AllInCandidates | null {
  const roomId = card.closest("[data-room-identifier]")?.getAttribute("data-room-identifier");
  const room = roomId ? roomRates.get(roomId) : undefined;
  if (!room) return null;
  return { allInPrice: room.allInPrice, sitePriceTotals: room.sitePriceTotals, nights: room.nights };
}

function priceTextNode(el: Element): Text | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (/\d/.test(node.nodeValue || "")) return node as Text;
  }
  return null;
}

export function readShownPrice(el: Element): number | null {
  const match = priceTextNode(el)?.nodeValue?.match(/\d[\d,]*(?:\.\d+)?/);
  return match ? Number(match[0].replace(/,/g, "")) : null;
}

/**
 * The fee note lives inside `pricing-text` on the live page, but HTML re-parsing (saved fixtures) moves
 * it out of the <p>, so look for the exact note anywhere in the price card.
 */
function relabelFees(scope: Element): void {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue || "";
    if (FEES_LABEL.test(text.trim())) node.nodeValue = text.replace(/includes fees/i, ALL_IN_LABEL);
  }
}

/**
 * Shows the all-in total in `priceEl` (and relabels the fee note under `labelScope`) when the element
 * shows one of the site's other totals. Edits the existing text node so React's own later updates to
 * the price still land, and are replaced again on the next pass.
 */
export function applyAllInPrice(
  priceEl: Element,
  candidates: AllInCandidates | null,
  labelScope?: Element
): boolean {
  if (!candidates) return false;
  const textNode = priceTextNode(priceEl);
  const shown = readShownPrice(priceEl);
  if (!textNode || shown === null) return false;

  const amount = resolveAllInAmount(shown, candidates);
  if (amount !== null) {
    const formatted = Math.round(amount).toLocaleString("en-US");
    textNode.nodeValue = (textNode.nodeValue || "").replace(/\d[\d,]*(?:\.\d+)?/, formatted);
    priceEl.setAttribute(REPLACED_ATTR, "true");
  }

  // Only relabel prices this extension replaced; a price the site already shows all-in keeps its UI
  const replaced = priceEl.getAttribute(REPLACED_ATTR) === "true";
  if (replaced && labelScope) relabelFees(labelScope);
  return amount !== null;
}
