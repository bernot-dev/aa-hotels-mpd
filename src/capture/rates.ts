import { CapturedRate } from "../types";
import { extractNumber } from "../cards";

export function extractRatesFromSearchCards(
  container: Element,
  nights: number,
  includeBonusMiles: boolean
): CapturedRate[] {
  const cardSelector = '[data-testid="hotel-card-pricing"]';
  const priceSelector = '[data-testid="earn-price"]';
  const priceTypeSelector = '[data-testid="pricing-text"]';
  const tierSelector = '[data-testid$="tier-earn-rewards"]';

  const cards = container.querySelectorAll(cardSelector);
  const captured: CapturedRate[] = [];

  cards.forEach((card) => {
    const hasBoostTag = !!card.querySelector('[data-testid="boost-tag-container"]');
    if (hasBoostTag && !includeBonusMiles) {
      return;
    }

    const dollarsElem = card.querySelector(priceSelector);
    if (!dollarsElem) return;

    const dollars = extractNumber(dollarsElem);
    if (!dollars || dollars <= 0) return;

    const pricingTextElem = card.querySelector(priceTypeSelector);
    const isTotalPrice = pricingTextElem?.textContent?.trim().startsWith("Total") ?? false;

    // Extract hotel name, hotel ID, and destination by walking up container
    let hotelName = "Unknown Hotel";
    let hotelId: string | undefined = undefined;
    let cardLocation: string | undefined = undefined;

    let parent: Element | null = card;
    for (let i = 0; i < 6; i++) {
      if (!parent) break;
      const nameEl = parent.querySelector('[data-testid="hotel-name"]');
      if (nameEl && nameEl.textContent) {
        hotelName = nameEl.textContent.trim();
      }

      const linkEl =
        parent.querySelector('a[href*="id="], a[href*="destination="]') ||
        (parent.tagName === "A" && (parent.getAttribute("href")?.includes("id=") || parent.getAttribute("href")?.includes("destination="))
          ? parent
          : null);
      if (linkEl) {
        const href = linkEl.getAttribute("href");
        if (href) {
          const idMatch = href.match(/[?&]id=([^&]+)/);
          if (idMatch && !hotelId) {
            hotelId = idMatch[1];
          }
          const destMatch = href.match(/[?&]destination=([^&]+)/);
          if (destMatch && !cardLocation) {
            try {
              cardLocation = decodeURIComponent(destMatch[1].replace(/\+/g, " ").trim());
            } catch {}
          }
        }
      }

      if (hotelName !== "Unknown Hotel" && hotelId && cardLocation) break;
      parent = parent.parentElement;
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
        location: cardLocation,
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
  const cardSelector = '[data-testid="room-card"]';
  const priceSelector = '[data-testid="earn-price"]';
  const priceTypeSelector = '[data-testid="pricing-text"]';
  const tierSelector = '[data-testid$="tier-earn-rewards"]';

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
      hotelId = url.searchParams.get("id") || undefined;
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
    const hasBoostTag = !!card.querySelector('[data-testid="boost-tag-container"]');
    if (hasBoostTag && !includeBonusMiles) {
      return;
    }

    const dollarsElem = card.querySelector(priceSelector);
    if (!dollarsElem) return;

    const dollars = extractNumber(dollarsElem);
    if (!dollars || dollars <= 0) return;

    const pricingTextElem = card.querySelector(priceTypeSelector);
    const isTotalPrice = pricingTextElem?.textContent?.trim().startsWith("Total") ?? false;

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
