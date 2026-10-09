import { CapturedRate } from "../types";
import { extractNumber } from "../cards";
import { isValidLocation } from "./criteria";
import { getEnrichedHotel, getHotelIdFromCard } from "../registry";

export function extractRatesFromSearchCards(
  container: Element,
  nights: number,
  includeBonusMiles: boolean
): CapturedRate[] {
  const cardSelector = 'li.PropertyCardItem, [data-selenium="hotel-item"], [data-element-name="property-card"]';
  const priceSelector = '[data-selenium="display-price"], .PropertyCardPrice__Value';
  const priceTypeSelector = '[data-selenium="hotel-currency"], .PropertyCardPrice__Currency';
  const tierSelector = '[data-selenium="points-max-promo-text"], [data-selenium="points-max"], [data-selenium="loyalty-offer"]';

  const cards = container.querySelectorAll(cardSelector);
  const captured: CapturedRate[] = [];

  cards.forEach((card) => {
    const hasBoostTag = !!card.querySelector('[data-selenium="boost-tag"], [data-element-name="boost-tag"]');
    if (hasBoostTag && !includeBonusMiles) {
      return;
    }

    const dollarsElem = card.querySelector(priceSelector);
    if (!dollarsElem) return;

    const dollars = extractNumber(dollarsElem);
    if (!dollars || dollars <= 0) return;

    const pricingTextElem = card.querySelector(priceTypeSelector);
    const textContent = pricingTextElem?.textContent?.trim().toLowerCase() || "";
    const isNightly = textContent.includes("night") || textContent.includes("/nt");
    const isTotalPrice = !isNightly || textContent.includes("total");

    // Extract hotel name, hotel ID, and destination by walking up container
    let hotelName = "Unknown Hotel";
    let hotelId: string | undefined = undefined;
    let cardLocation: string | undefined = undefined;
    let cardNeighborhood: string | undefined = undefined;

    let parent: Element | null = card;
    for (let i = 0; i < 8; i++) {
      if (!parent) break;
      if (hotelName === "Unknown Hotel") {
        const nameEl = parent.querySelector(
          '[data-selenium="hotel-name"], [data-element-name="property-card-title"], .PropertyCardItem__Name, [data-testid="hotel-name"], h3:not([data-selenium="display-price"]):not(.PropertyCardPrice__Value)'
        );
        if (nameEl && nameEl.textContent) {
          const candidate = nameEl.textContent.trim();
          if (candidate && !/^\$\d+/.test(candidate)) {
            hotelName = candidate;
          }
        }
      }

      if (!cardNeighborhood) {
        const neighborhoodEl = parent.querySelector('[data-selenium="area-city-name"], [data-element-name="area-city-name"]');
        if (neighborhoodEl && neighborhoodEl.textContent) {
          cardNeighborhood = neighborhoodEl.textContent.trim();
        }
      }

      const allLinks = Array.from(
        parent.querySelectorAll<HTMLAnchorElement>(
          'a[href*="propertyId="], a[href*="hotelId="], a[data-selenium="hotel-item-link"], a[href*="destination="], a[href*="/accom/property"]'
        )
      );
      if (parent.tagName === "A") {
        allLinks.unshift(parent as HTMLAnchorElement);
      }

      for (const linkEl of allLinks) {
        const href = linkEl.getAttribute("href") || "";
        if (!hotelId) {
          const idMatch = href.match(/[?&](?:propertyId|hotelId|id)=([^&]+)/);
          if (idMatch) {
            hotelId = idMatch[1];
          }
        }
        if (!cardLocation) {
          const destMatch =
            href.match(/[?&]destination=([^&]+)/) ||
            href.match(/[?&]city=([^&]+)/) ||
            href.match(/[?&]location=([^&]+)/);
          if (destMatch) {
            try {
              const decoded = decodeURIComponent(destMatch[1].replace(/\+/g, " ").trim());
              if (isValidLocation(decoded)) {
                cardLocation = decoded;
              }
            } catch {}
          }
        }
        if (hotelId && cardLocation) break;
      }

      if (hotelName !== "Unknown Hotel" && hotelId && cardLocation) break;
      parent = parent.parentElement;
    }

    if (!hotelId) {
      hotelId = getHotelIdFromCard(card) || undefined;
    }

    let finalLocation = cardLocation;
    const enriched = hotelId ? getEnrichedHotel(hotelId) : undefined;
    if (enriched) {
      if (enriched.hotelName && hotelName === "Unknown Hotel") {
        hotelName = enriched.hotelName;
      }
      if (enriched.location && isValidLocation(enriched.location)) {
        finalLocation = enriched.location;
      }
    }

    // Determine final card location if not resolved by enriched data: link destination > card neighborhood > hotel name city
    if (!finalLocation && cardNeighborhood && isValidLocation(cardNeighborhood)) {
      finalLocation = cardNeighborhood;
    } else if (!finalLocation && hotelName !== "Unknown Hotel") {
      const cityMatch = hotelName.match(/,\s*([^,]+)$/);
      if (cityMatch && isValidLocation(cityMatch[1].trim())) {
        finalLocation = cityMatch[1].trim();
      }
    }

    const tiers = card.querySelectorAll(tierSelector);
    tiers.forEach((tier) => {
      const miles = extractNumber(tier);
      if (!miles || miles <= 0) return;

      const mpd = isTotalPrice ? miles / dollars : miles / dollars / (nights || 1);
      if (isNaN(mpd) || !isFinite(mpd) || mpd <= 0) return;

      captured.push({
        hotelName,
        hotelId,
        location: finalLocation,
        price: dollars,
        miles,
        mpd: Number(mpd.toFixed(1)),
        isTotalPrice,
        isBonus: hasBoostTag,
      });
    });
  });

  return captured;
}

export function extractRatesFromDetailsCards(
  container: Element,
  nights: number,
  includeBonusMiles: boolean,
  hotelNameFallback: string = "Hotel Details"
): CapturedRate[] {
  const cardSelector = '[data-selenium="master-room-card"], [data-selenium="room-card"], [data-element-name="room-card"], .MasterRoom';
  const priceSelector = '[data-selenium="display-price"], .PropertyCardPrice__Value';
  const priceTypeSelector = '[data-selenium="hotel-currency"], .PropertyCardPrice__Currency';
  const tierSelector = '[data-selenium="points-max-promo-text"], [data-selenium="points-max"], [data-selenium="loyalty-offer"]';

  // Try extracting hotel name from document headings
  let hotelName = hotelNameFallback;
  const doc = container.ownerDocument || (typeof document !== "undefined" ? document : null);
  const heading = doc?.querySelector("h1, h2");
  if (heading && heading.textContent && heading.textContent.trim()) {
    hotelName = heading.textContent.trim();
  }

  // Try extracting hotel ID and destination from URL or document
  let hotelId: string | undefined;
  let detailsLocation: string | undefined;
  if (typeof window !== "undefined") {
    try {
      const url = new URL(window.location.href);
      hotelId = url.searchParams.get("propertyId") || url.searchParams.get("hotelId") || url.searchParams.get("id") || undefined;
      const destParam = url.searchParams.get("destination");
      if (destParam && destParam.trim()) {
        detailsLocation = decodeURIComponent(destParam.trim().replace(/\+/g, " "));
      }
    } catch {}
  }

  if (!detailsLocation && doc) {
    const cityEl = doc.querySelector('[data-testid="address-city"]');
    const countryEl = doc.querySelector('[data-testid="address-country"]');
    if (cityEl && cityEl.textContent?.trim()) {
      const city = cityEl.textContent.trim();
      const country = countryEl?.textContent?.trim();
      detailsLocation = country ? `${city}, ${country}` : city;
    }
  }

  const cards = container.querySelectorAll(cardSelector);
  const captured: CapturedRate[] = [];

  cards.forEach((card) => {
    const hasBoostTag = !!card.querySelector(
      '[data-selenium="boost-tag"], [data-element-name="boost-tag"]'
    );
    if (hasBoostTag && !includeBonusMiles) {
      return;
    }

    const dollarsElem = card.querySelector(priceSelector);
    if (!dollarsElem) return;

    const dollars = extractNumber(dollarsElem);
    if (!dollars || dollars <= 0) return;

    const pricingTextElem = card.querySelector(priceTypeSelector);
    const textContent = pricingTextElem?.textContent?.trim().toLowerCase() || "";
    const isNightly = textContent.includes("night") && !textContent.includes("total");
    const isTotalPrice = !isNightly || textContent.includes("total");

    const tiers = card.querySelectorAll(tierSelector);
    tiers.forEach((tier) => {
      const miles = extractNumber(tier);
      if (!miles || miles <= 0) return;

      const mpd = isTotalPrice ? miles / dollars : miles / dollars / (nights || 1);
      if (isNaN(mpd) || !isFinite(mpd) || mpd <= 0) return;

      captured.push({
        hotelName,
        hotelId,
        location: detailsLocation,
        price: dollars,
        miles,
        mpd: Number(mpd.toFixed(1)),
        isTotalPrice,
        isBonus: hasBoostTag,
      });
    });
  });

  return captured;
}
