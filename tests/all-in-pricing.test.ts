import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { processCard } from "../src/cards";
import {
  hotelMpdRegistry,
  hotelDataRegistry,
  clearHotelMpdRegistry,
  ingestHotelRates,
  getEnrichedHotel,
  getHotelMPD,
} from "../src/registry";
import { EnrichedHotelRate } from "../src/interceptor";

describe("All-In Pricing & Race Condition Safeguards", () => {
  let doc: Document;

  beforeEach(() => {
    clearHotelMpdRegistry();
    const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
    doc = dom.window.document;
  });

  const createSampleCard = (hotelId: string, domPrice: number = 298, miles: number = 4500): HTMLElement => {
    const card = doc.createElement("section");
    card.setAttribute("data-testid", `hotel-card-${hotelId}`);
    card.innerHTML = `
      <div data-testid="hotel-card-pricing">
        <span data-testid="pricing-text">Total</span>
        <span data-testid="earn-price">$${domPrice}</span>
        <div data-testid="base-tier-earn-rewards">Earn ${miles} miles</div>
      </div>
    `;
    doc.body.appendChild(card);
    return card.querySelector('[data-testid="hotel-card-pricing"]')!;
  };

  const sampleEnrichedHotel: EnrichedHotelRate = {
    hotelId: "12345",
    hotelName: "Grand Flagstaff Resort",
    price: 331.94,
    basePrice: 298.0,
    allInPrice: 331.94,
    nightlyPrice: 149.0,
    fees: 80.04,
    baseMiles: 400,
    tieredMiles: 4500,
    city: "Flagstaff",
    state: "AZ",
    location: "Flagstaff, AZ",
    neighborhood: "Southside",
    zipcode: "86004",
    stars: 4.0,
    rating: 9.5,
    reviewCount: 4055,
    searchId: "search-session-1",
    checkInDate: "2026-11-16",
    checkOutDate: "2026-11-18",
    nights: 2,
    refundable: true,
  };

  it("calculates All-In MPD by default when enriched hotel data is available", () => {
    ingestHotelRates([sampleEnrichedHotel], true, true);

    const cardPricing = createSampleCard("12345", 298, 4500);
    const { cardMaxMPD } = processCard(cardPricing, 2, true, true);

    // All-In MPD = 4500 / 331.94 = 13.556... -> 13.6
    expect(cardMaxMPD).toBeCloseTo(13.556, 1);

    const badge = cardPricing.querySelector<HTMLElement>(".aa-mpd-badge");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe(" (13.6\u00A0miles/$)");
    expect(badge?.getAttribute("data-pricing-type")).toBe("all-in");
    expect(badge?.title).toContain("Total with taxes & fees: $331.94");
    expect(badge?.getAttribute("data-pending-api")).toBeNull();
  });

  it("calculates Base MPD when useAllInPricing is false", () => {
    ingestHotelRates([sampleEnrichedHotel], true, false);

    const cardPricing = createSampleCard("12345", 298, 4500);
    const { cardMaxMPD } = processCard(cardPricing, 2, true, false);

    // Base MPD = 4500 / 298.0 = 15.100... -> 15.1
    expect(cardMaxMPD).toBeCloseTo(15.1, 1);

    const badge = cardPricing.querySelector<HTMLElement>(".aa-mpd-badge");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe(" (15.1\u00A0miles/$)");
    expect(badge?.getAttribute("data-pricing-type")).toBe("base");
  });

  it("handles Race Condition 1: DOM renders before API response, then upgrades reactively", () => {
    // 1. DOM renders first (registry is empty)
    const cardPricing = createSampleCard("12345", 298, 4500);
    const resultInitial = processCard(cardPricing, 2, true, true);

    // Initial fallback uses DOM price: 4500 / 298 = 15.1 MPD and marks pending
    expect(resultInitial.cardMaxMPD).toBeCloseTo(15.1, 1);
    const initialBadge = cardPricing.querySelector<HTMLElement>(".aa-mpd-badge");
    expect(initialBadge?.getAttribute("data-pending-api")).toBe("true");
    expect(initialBadge?.textContent).toBe(" (15.1\u00A0miles/$)");

    // 2. Network interceptor event arrives later
    ingestHotelRates([sampleEnrichedHotel], true, true);

    // 3. Reactive upgrade runs
    const resultUpgraded = processCard(cardPricing, 2, true, true);
    expect(resultUpgraded.cardMaxMPD).toBeCloseTo(13.6, 1);

    const upgradedBadge = cardPricing.querySelector<HTMLElement>(".aa-mpd-badge");
    expect(upgradedBadge?.getAttribute("data-pending-api")).toBeNull();
    expect(upgradedBadge?.getAttribute("data-pricing-type")).toBe("all-in");
    expect(upgradedBadge?.textContent).toBe(" (13.6\u00A0miles/$)");
  });

  it("handles Race Condition 2: API response arrives before DOM renders", () => {
    // 1. API response arrives and is cached
    ingestHotelRates([sampleEnrichedHotel], true, true);
    expect(getEnrichedHotel("12345")).toBeDefined();

    // 2. DOM mounts card later
    const cardPricing = createSampleCard("12345", 298, 4500);
    const { cardMaxMPD } = processCard(cardPricing, 2, true, true);

    // Renders with all-in pricing on first paint
    expect(cardMaxMPD).toBeCloseTo(13.6, 1);
    const badge = cardPricing.querySelector<HTMLElement>(".aa-mpd-badge");
    expect(badge?.getAttribute("data-pending-api")).toBeNull();
    expect(badge?.textContent).toBe(" (13.6\u00A0miles/$)");
  });

  it("handles Race Condition 3: invalidates stale registry when search session or dates change", () => {
    // Search session A (Flagstaff, Nov 16-18)
    ingestHotelRates([sampleEnrichedHotel], true, true);
    expect(hotelDataRegistry.has("12345")).toBe(true);

    // Search session B arrives (Phoenix, Dec 24-26 with new searchId)
    const newSearchHotel: EnrichedHotelRate = {
      ...sampleEnrichedHotel,
      hotelId: "99999",
      hotelName: "Phoenix Luxury Suites",
      searchId: "search-session-2",
      checkInDate: "2026-12-24",
      checkOutDate: "2026-12-26",
      city: "Phoenix",
      state: "AZ",
      location: "Phoenix, AZ",
    };

    ingestHotelRates([newSearchHotel], true, true);

    // Old hotel from Search A should be cleared from active registry
    expect(hotelDataRegistry.has("12345")).toBe(false);
    expect(hotelDataRegistry.has("99999")).toBe(true);
    expect(hotelMpdRegistry.has("99999")).toBe(true);
  });
});
