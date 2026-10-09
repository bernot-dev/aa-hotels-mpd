import { CapturedRate } from "../types";
import {
  extractNumber,
  extractPrice,
  getMilesElements,
  innermostCards,
  isTotalPriceText,
  CARD_SELECTOR,
  ROOM_CARD_SELECTOR,
  PRICE_SELECTOR,
  PRICE_TYPE_SELECTOR,
} from "../cards";
import { isValidLocation } from "./criteria";
import { DEFAULT_EARNING_LEVEL, EarningLevel } from "../settings";
import { getEnrichedHotel, getHotelIdFromCard } from "../registry";

/**
 * Miles shown for the earning level: cards list one line per level, the lowest being
 * "AAdvantage member" and the highest "credit cardmembers with status".
 */
function selectedLevelMiles(card: Element, earningLevel: EarningLevel): number | null {
  const amounts = getMilesElements(card)
    .map((el) => extractNumber(el) || 0)
    .filter((miles) => miles > 0);
  if (amounts.length === 0) return null;
  return earningLevel === "member" ? Math.min(...amounts) : Math.max(...amounts);
}

/**
 * First photo of a search card's gallery, as an absolute URL.
 */
function getCardImageUrl(card: Element): string | undefined {
  const src = card.querySelector('img[data-element-name="ssrweb-mosaicphotos"]')?.getAttribute("src");
  if (!src) return undefined;
  return src.startsWith("//") ? `https:${src}` : src;
}

/**
 * Text of a hotel name element without nested extras such as star-rating screen-reader text.
 */
function getOwnHeadingText(nameEl: Element): string {
  const heading = nameEl.matches("h1, h2, h3") ? nameEl : nameEl.querySelector("h1, h2, h3") || nameEl;
  const ownText = Array.from(heading.childNodes)
    .filter((n) => n.nodeType === 3)
    .map((n) => n.textContent || "")
    .join("")
    .trim();
  return ownText || heading.textContent?.trim() || "";
}

export function extractRatesFromSearchCards(
  container: Element,
  nights: number,
  includeBonusMiles: boolean,
  earningLevel: EarningLevel = DEFAULT_EARNING_LEVEL
): CapturedRate[] {
  const cards = innermostCards(container.querySelectorAll(CARD_SELECTOR));
  const captured: CapturedRate[] = [];

  cards.forEach((card) => {
    const hasBoostTag = !!card.querySelector('[data-selenium="boost-tag"], [data-element-name="boost-tag"]');
    if (hasBoostTag && !includeBonusMiles) {
      return;
    }

    const dollarsElem = card.querySelector(PRICE_SELECTOR);
    if (!dollarsElem) return;

    const dollars = extractPrice(dollarsElem);
    if (!dollars || dollars <= 0) return;

    const pricingTextElem = card.querySelector(PRICE_TYPE_SELECTOR);
    const isTotalPrice = isTotalPriceText(pricingTextElem?.textContent || "");

    // Extract hotel name, hotel ID, and destination by walking up container
    let hotelName = "Unknown Hotel";
    let hotelId: string | undefined = getHotelIdFromCard(card) || undefined;
    let cardLocation: string | undefined = undefined;
    let cardNeighborhood: string | undefined = undefined;

    let parent: Element | null = card;
    for (let i = 0; i < 8; i++) {
      if (!parent) break;
      // Stop at shared containers: anything above holds other hotels' names and links
      if (parent !== card && parent.querySelectorAll(CARD_SELECTOR).length > 1) break;
      if (hotelName === "Unknown Hotel") {
        const nameEl = parent.querySelector(
          '[data-selenium="hotel-name"], [data-element-name="property-card-title"], .PropertyCardItem__Name, [data-testid="hotel-name"], h3:not([data-selenium="display-price"]):not(.PropertyCardPrice__Value)'
        );
        if (nameEl && nameEl.textContent) {
          const candidate = getOwnHeadingText(nameEl);
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

      if (!cardLocation) {
        // e.g. "Grand Prairie, Dallas (TX) - 14.48 mi to center" -> "Dallas, TX"
        const areaText = parent.querySelector('[data-selenium="area-city-text"]')?.textContent || "";
        const cityState = areaText.match(/([^,()]+?)\s*\(([A-Z]{2})\)/);
        if (cityState) {
          cardLocation = `${cityState[1].trim()}, ${cityState[2]}`;
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
      if (enriched.hotelName && enriched.hotelName !== "Unknown Hotel") {
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

    const miles = selectedLevelMiles(card, earningLevel);
    if (!miles) return;

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
      // Hotel details for the dashboard, from the intercepted API data when available
      imageUrl: enriched?.imageUrl || getCardImageUrl(card),
      stars: enriched?.stars,
      rating: enriched?.rating,
      reviewCount: enriched?.reviewCount,
      refundable: enriched?.refundable,
      neighborhood: enriched?.neighborhood,
      country: enriched?.country,
      basePrice: enriched?.basePrice,
      allInPrice: enriched?.allInPrice,
    });
  });

  return captured;
}

export function extractRatesFromDetailsCards(
  container: Element,
  nights: number,
  includeBonusMiles: boolean,
  hotelNameFallback: string = "Hotel Details",
  earningLevel: EarningLevel = DEFAULT_EARNING_LEVEL
): CapturedRate[] {

  // Try extracting hotel name from document headings
  let hotelName = hotelNameFallback;
  const doc = container.ownerDocument || (typeof document !== "undefined" ? document : null);
  const heading = doc?.querySelector('[data-selenium="hotel-header-name"], h1, h2');
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

  const cards = innermostCards(container.querySelectorAll(ROOM_CARD_SELECTOR));
  const captured: CapturedRate[] = [];

  cards.forEach((card) => {
    const hasBoostTag = !!card.querySelector(
      '[data-selenium="boost-tag"], [data-element-name="boost-tag"]'
    );
    if (hasBoostTag && !includeBonusMiles) {
      return;
    }

    const dollarsElem = card.querySelector(PRICE_SELECTOR);
    if (!dollarsElem) return;

    const dollars = extractPrice(dollarsElem);
    if (!dollars || dollars <= 0) return;

    const pricingTextElem = card.querySelector(PRICE_TYPE_SELECTOR);
    const isTotalPrice = isTotalPriceText(pricingTextElem?.textContent || "");

    const miles = selectedLevelMiles(card, earningLevel);
    if (!miles) return;

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

  return captured;
}
