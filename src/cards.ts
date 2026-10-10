import { getNights } from "./nights";
import {
  registerHotelMPD,
  registerHotelPrice,
  getHotelIdFromCard,
  getCurrentPageBestMPD,
  getLocationBestMPD,
  getEnrichedHotel,
  getMpdDot,
  getSearchSetMpdRange,
  getSearchSetPriceRange,
  getPriceDollarSigns,
} from "./registry";
import {
  applyAllInPrice,
  candidatesFromHotel,
  candidatesFromRoom,
} from "./allin";
import { getLogoUrl } from "./logo";
import { DEFAULT_EARNING_LEVEL, EarningLevel, milesForEarningLevel } from "./settings";
import type { EnrichedHotelRate } from "./interceptor";
import { updateSummaryBanner } from "./search-query";

export const extractNumber = (e: Element): number | null => {
  // Ignore text inside our own injected badges when extracting original numbers
  const clone = e.cloneNode(true) as Element;
  const badges = clone.querySelectorAll('.aa-mpd-badge');
  badges.forEach((b) => b.remove());

  const match = clone.textContent?.match(/[\d,]+/)?.[0]?.replace(/,/g, "");
  return match ? Number(match) : null;
};

export const CARD_SELECTOR =
  'li.PropertyCardItem, [data-selenium="hotel-item"], [data-element-name="property-card"]';
export const ROOM_CARD_SELECTOR =
  '[data-selenium="ChildRoomsList-room"], [data-selenium="master-room-card"], [data-selenium="room-card"], [data-element-name="room-card"], .MasterRoom';
export const PRICE_SELECTOR =
  '[data-element-name="fpc-room-price"], [data-selenium="display-price"], .PropertyCardPrice__Value';
export const PRICE_TYPE_SELECTOR =
  '[data-element-name="fpc-price-text"], [data-selenium="hotel-currency"], .PropertyCardPrice__Currency';
export const TIER_SELECTOR =
  '[data-testid="upc_caption"], [data-selenium="points-max-promo-text"], [data-selenium="points-max"], [data-selenium="loyalty-offer"]';

export const BOOST_SELECTOR =
  '[data-element-name="boost-applied-badge"], [data-element-name="jacket-boost"], [data-selenium="boost-tag"], [data-element-name="boost-tag"]';

export const BOOST_JACKET_SELECTOR =
  '[data-element-name="jacket-boost"]';

export const BOOST_STYLE_ID = "aa-mpd-boost-jacket-styles";

/**
 * Checks whether a card or room offer represents a bonus miles / boost promotion.
 */
export function isBonusOffer(card: Element): boolean {
  if (
    card.querySelector(BOOST_SELECTOR) ||
    (typeof card.matches === "function" && card.matches(BOOST_SELECTOR))
  ) {
    return true;
  }
  const clone = card.cloneNode(true) as Element;
  clone.querySelectorAll(".aa-mpd-badge").forEach((b) => b.remove());
  return /bonus\s+miles/i.test(clone.textContent || "");
}

/**
 * Injects or removes global CSS rules for hiding boost jackets when bonus miles offers are unchecked.
 */
export function updateBoostJacketStyles(includeBonusMiles: boolean): void {
  if (typeof document === "undefined") return;
  let style = document.getElementById(BOOST_STYLE_ID) as HTMLStyleElement | null;
  if (!includeBonusMiles) {
    if (!style) {
      style = document.createElement("style");
      style.id = BOOST_STYLE_ID;
      style.textContent = `
        [data-element-name="jacket-boost"] {
          display: none !important;
        }
      `;
      document.head?.appendChild(style);
    }
  } else if (style) {
    style.remove();
  }
}

const MILES_TEXT = /earn\s+[\d,]+\s+(?:aadvantage\s+)?miles/i;

/**
 * Returns the elements in a card that state a miles earn amount (e.g. "Earn 1,100 miles").
 */
export const getMilesElements = (card: Element): Element[] =>
  Array.from(card.querySelectorAll(TIER_SELECTOR)).filter((el) => {
    if (el.getAttribute("data-testid") !== "upc_caption") return true;
    const clone = el.cloneNode(true) as Element;
    clone.querySelectorAll(".aa-mpd-badge").forEach((b) => b.remove());
    return MILES_TEXT.test(clone.textContent || "");
  });

/**
 * Reads a card's displayed price in USD. Returns null for missing prices or prices in another currency.
 */
export const extractPrice = (priceElem: Element): number | null => {
  const text = priceElem.textContent?.trim() || "";
  const currency = text.match(/^([A-Z]{3})\b/)?.[1];
  if (currency && currency !== "USD") return null;

  const fpcValue = Number(priceElem.getAttribute("data-fpc-value"));
  if (fpcValue > 0) return fpcValue;
  return extractNumber(priceElem);
};

/**
 * Whether a price note describes the whole stay ("2 nights including taxes and fees", "Total (2 nights)")
 * rather than a nightly rate ("per night", "/night", "avg. nightly").
 */
export const isTotalPriceText = (priceTypeText: string): boolean => {
  const text = priceTypeText.trim().toLowerCase();
  if (!text || text.includes("total")) return true;
  if (/\d+\s+nights?\b/.test(text)) return true;
  return !/per\s+night|\/\s*night|\/\s*nt\b|nightly/.test(text);
};

/**
 * Drops cards that contain another matching card, so a grouping container (e.g. a master room)
 * isn't processed with the price of its first child.
 */
export const innermostCards = (cards: ArrayLike<Element>): Element[] => {
  const list = Array.from(cards);
  return list.filter((card) => !list.some((other) => other !== card && card.contains(other)));
};

export const CHIP_STYLE_ID = "aa-mpd-chip-styles";

export function calculateNightlyPrice(
  price: number,
  enriched: EnrichedHotelRate | undefined,
  nights: number = 1,
  useAllInPricing: boolean = true
): number {
  if (enriched && useAllInPricing && enriched.nightlyPrice > 0) {
    return enriched.nightlyPrice;
  }
  const stayNights = (enriched?.nights && enriched.nights > 0) ? enriched.nights : (nights > 0 ? nights : 1);
  const effectiveTotalPrice = (enriched && useAllInPricing && enriched.allInPrice > 0)
    ? enriched.allInPrice
    : (enriched && enriched.basePrice > 0 ? enriched.basePrice : price);
  if (effectiveTotalPrice > 0 && stayNights > 0) {
    return effectiveTotalPrice / stayNights;
  }
  return 0;
}

export function calculateCPM(mpd: number): number {
  if (isNaN(mpd) || !isFinite(mpd) || mpd <= 0) return 0;
  return Number((100 / mpd).toFixed(1));
}

export function ensureChipStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(CHIP_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = CHIP_STYLE_ID;
  style.textContent = `
    /* AA Hotels MPD UI Chip */
    .aa-mpd-badge,
    .aa-mpd-chip {
      display: inline-flex !important;
      align-items: center !important;
      vertical-align: middle !important;
      border-radius: 12px !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
      font-size: 13px !important;
      font-weight: 600 !important;
      line-height: 1.3 !important;
      white-space: nowrap !important;
      text-decoration: none !important;
      box-sizing: border-box !important;
      user-select: none !important;
      width: fit-content !important;
      cursor: default !important;
      
      /* On-brand AA Blue / Loyalty style */
      background: #eef5fc !important;
      color: #0b3558 !important;
      border: 1px solid #bfdbfe !important;
      box-shadow: 0 1px 3px rgba(11, 53, 88, 0.08) !important;
      transition: all 0.15s ease-in-out !important;
    }

    [data-element-name="property-card-info"] .aa-mpd-chip {
      margin-top: 10px !important;
      margin-bottom: 6px !important;
      padding: 8px 14px !important;
    }

    [data-testid="upc_caption"] .aa-mpd-chip,
    [data-selenium^="points-max"] .aa-mpd-chip {
      margin-left: 6px !important;
      padding: 3px 10px !important;
      border-radius: 9999px !important;
      font-size: 12px !important;
      gap: 7px !important;
    }

    .aa-mpd-badge:hover,
    .aa-mpd-chip:hover {
      background: #e2effd !important;
      border-color: #93c5fd !important;
      box-shadow: 0 2px 6px rgba(11, 53, 88, 0.12) !important;
    }

    .aa-mpd-badge.aa-mpd-high-rate,
    .aa-mpd-badge[style*="green"] {
      border-color: #86efac !important;
    }

    .aa-mpd-chip-inner {
      display: inline-flex !important;
      align-items: center !important;
      gap: 12px !important;
    }

    .aa-mpd-chip-icon {
      width: 40px !important;
      height: 40px !important;
      object-fit: contain !important;
      flex-shrink: 0 !important;
      display: inline-block !important;
      vertical-align: middle !important;
    }

    .aa-mpd-chip-icon-sm {
      width: 16px !important;
      height: 16px !important;
    }

    .aa-mpd-chip-rows {
      display: flex !important;
      flex-direction: column !important;
      gap: 2px !important;
    }

    .aa-mpd-chip-row {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      font-size: 12px !important;
      font-weight: 600 !important;
      color: #0d2440 !important;
      line-height: 1.3 !important;
    }

    .aa-mpd-chip-indicator {
      min-width: 42px !important;
      text-align: center !important;
      display: inline-block !important;
      font-size: 13px !important;
      flex-shrink: 0 !important;
    }

    .aa-mpd-chip-dollars {
      font-size: 12px !important;
      letter-spacing: -1px !important;
    }

    .aa-mpd-chip-divider {
      opacity: 0.35 !important;
      color: #0b3558 !important;
      font-weight: 300 !important;
      user-select: none !important;
      flex-shrink: 0 !important;
    }

    .aa-mpd-chip-value {
      font-weight: 600 !important;
      color: #0d2440 !important;
      white-space: nowrap !important;
    }

    .aa-mpd-chip-rate {
      font-weight: 700 !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 4px !important;
    }

    /* Summary Banner Refresh */
    #aa-mpd-search-summary,
    #aa-mpd-details-summary,
    .aa-mpd-banner {
      display: none;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
      background: linear-gradient(135deg, #f0f7ff 0%, #e1effe 100%) !important;
      color: #0d2440 !important;
      border: 1px solid #bfdbfe !important;
      border-left: 5px solid #0078d2 !important;
      border-radius: 10px !important;
      padding: 12px 18px !important;
      margin: 16px 0 !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
      font-size: 15px !important;
      line-height: 1.4 !important;
      box-shadow: 0 2px 8px rgba(13, 36, 64, 0.06) !important;
      box-sizing: border-box !important;
    }

    .aa-mpd-banner-header {
      display: flex !important;
      align-items: center !important;
      width: 100% !important;
      line-height: 1.4 !important;
    }

    .aa-mpd-banner-logo {
      width: 28px !important;
      height: 28px !important;
      object-fit: contain !important;
      flex-shrink: 0 !important;
      display: inline-block !important;
      vertical-align: middle !important;
      margin-right: 10px !important;
    }

    .aa-mpd-banner-text {
      display: inline !important;
      vertical-align: middle !important;
      color: #0d2440 !important;
    }

    .aa-mpd-banner-total {
      text-decoration: underline dotted !important;
      text-underline-offset: 3px !important;
      cursor: help !important;
    }

    .aa-mpd-banner-text b,
    .aa-mpd-banner-text strong {
      color: #004b87 !important;
      font-weight: 700 !important;
    }

    @keyframes aa-mpd-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .aa-mpd-banner-logo.aa-mpd-spinning {
      animation: aa-mpd-spin 1.2s linear infinite !important;
    }

    .aa-mpd-banner-alert-row {
      display: flex !important;
      margin-left: 38px !important;
      margin-top: 2px !important;
    }

    .aa-mpd-banner-alert {
      display: inline-flex !important;
      align-items: center !important;
      padding: 3px 10px !important;
      background: #fef3c7 !important;
      color: #92400e !important;
      border: 1px solid #fde68a !important;
      border-radius: 6px !important;
      font-size: 13px !important;
      font-weight: 500 !important;
      line-height: 1.2 !important;
    }
  `;
  document.head.appendChild(style);
}

export function createOrUpdateChip(
  container: Element,
  mpd: number,
  price: number,
  enriched: EnrichedHotelRate | undefined,
  useAllInPricing: boolean,
  minMpd?: number,
  maxMpd?: number,
  includePrice: boolean = true,
  nights: number = 1
): HTMLElement {
  ensureChipStyles();

  const formattedMPD = mpd.toFixed(1);
  const dot = getMpdDot(mpd, minMpd, maxMpd);
  const nightlyPrice = calculateNightlyPrice(price, enriched, nights, useAllInPricing);

  let chip = container.querySelector<HTMLElement>(':scope > .aa-mpd-badge') ||
             container.querySelector<HTMLElement>('.aa-mpd-badge');
  if (!chip) {
    chip = document.createElement('span');
    chip.className = 'aa-mpd-badge aa-mpd-chip';
    chip.setAttribute('data-aa-mpd', 'true');
    container.appendChild(chip);
  }

  chip.dataset.rate = formattedMPD;
  chip.dataset.dot = dot;
  if (nightlyPrice > 0) {
    chip.dataset.nightlyPrice = String(nightlyPrice);
  }

  const cpm = calculateCPM(mpd);
  const formattedCPM = cpm > 0 ? cpm.toFixed(1) : '0.0';
  chip.dataset.cpm = formattedCPM;

  if (enriched) {
    chip.removeAttribute('data-pending-api');
    chip.setAttribute('data-pricing-type', useAllInPricing ? 'all-in' : 'base');
    const baseP = enriched.basePrice > 0 ? enriched.basePrice : price;
    chip.title = `Earn: ${formattedMPD} miles per dollar (${formattedCPM}¢/mile)\nNightly: $${Math.round(nightlyPrice)}/night\nTotal with taxes & fees: $${enriched.allInPrice.toFixed(2)} (Base: $${baseP.toFixed(2)})`;
  } else {
    chip.setAttribute('data-pending-api', 'true');
    if (mpd > 0) {
      chip.title = `Earn: ${formattedMPD} miles per dollar (${formattedCPM}¢/mile)\nNightly: $${Math.round(nightlyPrice)}/night`;
    }
  }

  if (mpd >= 20) {
    chip.style.color = 'green';
    chip.style.fontWeight = 'bold';
    chip.classList.add('aa-mpd-high-rate');
  } else {
    chip.style.color = '';
    chip.style.fontWeight = '';
    chip.classList.remove('aa-mpd-high-rate');
  }

  let newHtml: string;
  if (includePrice) {
    const logoUrl = getLogoUrl(48);
    const dollarSigns = getPriceDollarSigns(nightlyPrice);
    const nightlyFormatted = nightlyPrice > 0 ? `$${Math.round(nightlyPrice).toLocaleString()}/nt` : '$0/nt';

    newHtml = [
      `<div class="aa-mpd-chip-inner">`,
      `  <img class="aa-mpd-chip-icon" src="${logoUrl}" alt="" aria-hidden="true" width="40" height="40" />`,
      `  <div class="aa-mpd-chip-rows">`,
      `    <div class="aa-mpd-chip-row">`,
      `      <span class="aa-mpd-chip-indicator">${dot}</span>`,
      `      <span class="aa-mpd-chip-divider">|</span>`,
      `      <span class="aa-mpd-chip-value">${formattedMPD} miles per dollar</span>`,
      `    </div>`,
      `    <div class="aa-mpd-chip-row">`,
      `      <span class="aa-mpd-chip-indicator">${dot}</span>`,
      `      <span class="aa-mpd-chip-divider">|</span>`,
      `      <span class="aa-mpd-chip-value">${formattedCPM}¢ per mile</span>`,
      `    </div>`,
      `    <div class="aa-mpd-chip-row">`,
      `      <span class="aa-mpd-chip-indicator aa-mpd-chip-dollars">${dollarSigns}</span>`,
      `      <span class="aa-mpd-chip-divider">|</span>`,
      `      <span class="aa-mpd-chip-value">${nightlyFormatted}</span>`,
      `    </div>`,
      `  </div>`,
      `</div>`,
    ].join('\n');
  } else {
    const logoUrl = getLogoUrl(32);
    newHtml = [
      `<img class="aa-mpd-chip-icon aa-mpd-chip-icon-sm" src="${logoUrl}" alt="" aria-hidden="true" width="16" height="16" />`,
      `<span class="aa-mpd-chip-rate">${dot} ${formattedMPD} mpd</span>`,
    ].join(' ');
  }

  if (chip.innerHTML !== newHtml) {
    chip.innerHTML = newHtml;
  }

  return chip;
}

export function updateCardDots(
  card: Element,
  minMpd: number,
  maxMpd: number,
  minPrice?: number,
  maxPrice?: number
): void {
  const chips = card.querySelectorAll<HTMLElement>('.aa-mpd-badge');
  chips.forEach((chip) => {
    const rate = Number(chip.dataset.rate);
    if (isNaN(rate) || rate <= 0) return;

    const dot = getMpdDot(rate, minMpd, maxMpd);
    chip.dataset.dot = dot;

    // Compact chip single rate text
    const rateSpan = chip.querySelector('.aa-mpd-chip-rate');
    if (rateSpan) {
      const newText = `${dot} ${rate.toFixed(1)} mpd`;
      if (rateSpan.textContent !== newText) {
        rateSpan.textContent = newText;
      }
    }

    // 3-row chip indicators
    const indicators = chip.querySelectorAll<HTMLElement>('.aa-mpd-chip-indicator');
    if (indicators.length >= 2) {
      if (indicators[0].textContent !== dot) indicators[0].textContent = dot;
      if (indicators[1].textContent !== dot) indicators[1].textContent = dot;
    }

    // 3-row chip dollar sign rating
    const nightlyPrice = Number(chip.dataset.nightlyPrice);
    if (nightlyPrice > 0 && indicators.length >= 3) {
      const dollars = getPriceDollarSigns(nightlyPrice, minPrice, maxPrice);
      if (indicators[2].textContent !== dollars) {
        indicators[2].textContent = dollars;
      }
    }
  });
}

export interface CardProcessResult {
  cardMaxMPD: number;
  processedTiers: number;
}

export const processCard = (
  card: Element,
  nights: number,
  includeBonusMiles: boolean,
  useAllInPricing: boolean = true,
  useEnrichment: boolean = true,
  earningLevel: EarningLevel = DEFAULT_EARNING_LEVEL
): CardProcessResult => {
  let cardMaxMPD = 0;
  let processedTiers = 0;

  const hotelId = getHotelIdFromCard(card);
  const enriched = hotelId && useEnrichment ? getEnrichedHotel(hotelId) : undefined;
  const dollarsElem = card.querySelector(PRICE_SELECTOR);

  // Show the all-in total in place of the site's price before reading it for MPD. Search and map
  // cards match by hotel id, details room cards by room identifier.
  if (useAllInPricing && dollarsElem) {
    applyAllInPrice(dollarsElem, enriched ? candidatesFromHotel(enriched) : candidatesFromRoom(card), card);
  }

  // Manage visibility of boost jackets in/around card
  const jackets = card.querySelectorAll<HTMLElement>(BOOST_JACKET_SELECTOR);
  jackets.forEach((j) => {
    j.style.display = includeBonusMiles ? "" : "none";
  });
  if (card instanceof HTMLElement && card.matches(BOOST_JACKET_SELECTOR)) {
    card.style.display = includeBonusMiles ? "" : "none";
  }

  // Search data is authoritative for any card it covers: a rendered card may show a rounded price,
  // or per-night prices and miles, so reading the card would change a hotel's rate (and its place in
  // the MPD sort) once it renders. The card's text is only read for cards without search data, such
  // as details page rooms.
  if (enriched) {
    const effectivePrice = getEnrichedPrice(enriched, useAllInPricing);
    const miles = milesForEarningLevel(enriched.baseMiles, enriched.tieredMiles, earningLevel);
    const mpd = effectivePrice > 0 ? miles / effectivePrice : 0;
    if (isFinite(mpd) && mpd > 0) {
      cardMaxMPD = mpd;
      processedTiers = 1;
    }
    return badgeCard(card, hotelId, cardMaxMPD, processedTiers, effectivePrice, true, enriched, useAllInPricing, nights, earningLevel);
  }

  // Respect user preference for bonus miles / boost tags. Search data carries base miles only, so
  // this only applies to rates read from the card.
  const hasBoost = isBonusOffer(card);
  if (hasBoost && !includeBonusMiles) {
    // If bonus miles are excluded, remove any previously injected badges, clear rate dataset and skip
    card.querySelectorAll(".aa-mpd-badge").forEach((b) => b.remove());
    if (card instanceof HTMLElement) {
      delete card.dataset.aaMpdRate;
    }
    card.closest("[data-aa-mpd-rate]")?.removeAttribute("data-aa-mpd-rate");
    return { cardMaxMPD: 0, processedTiers: 0 };
  }

  const effectivePrice = dollarsElem ? extractPrice(dollarsElem) || 0 : 0;
  if (effectivePrice <= 0) {
    return { cardMaxMPD: 0, processedTiers: 0 };
  }

  const pricingTextElem = card.querySelector(PRICE_TYPE_SELECTOR);
  const isTotalPrice = isTotalPriceText(pricingTextElem?.textContent || "");

  const tierMpds: number[] = [];
  getMilesElements(card).forEach((tier) => {
    const miles = extractNumber(tier);
    if (!miles || miles <= 0) {
      return;
    }

    const mpd = isTotalPrice ? miles / effectivePrice : miles / effectivePrice / (nights || 1);
    if (isNaN(mpd) || !isFinite(mpd) || mpd <= 0) {
      return;
    }

    tierMpds.push(mpd);
  });

  if (tierMpds.length > 0) {
    cardMaxMPD = earningLevel === "member" ? Math.min(...tierMpds) : Math.max(...tierMpds);
    processedTiers = tierMpds.length;
  }

  return badgeCard(card, hotelId, cardMaxMPD, processedTiers, effectivePrice, isTotalPrice, undefined, useAllInPricing, nights, earningLevel);
};

/** Price used for MPD from search data: the all-in total when enabled, else the base total. */
export const getEnrichedPrice = (enriched: EnrichedHotelRate, useAllInPricing: boolean): number =>
  useAllInPricing && enriched.allInPrice > 0
    ? enriched.allInPrice
    : enriched.basePrice > 0
    ? enriched.basePrice
    : enriched.price;

/** Records a card's rate and draws its badge (or, without a property-card-info box, one per tier). */
function badgeCard(
  card: Element,
  hotelId: string | null,
  cardMaxMPD: number,
  processedTiers: number,
  effectivePrice: number,
  effectiveIsTotalPrice: boolean,
  enriched: EnrichedHotelRate | undefined,
  useAllInPricing: boolean,
  nights: number,
  earningLevel: EarningLevel
): CardProcessResult {
  const tiers = getMilesElements(card);
  (card as HTMLElement).dataset.aaMpdRate = String(cardMaxMPD);

  if (cardMaxMPD > 0 && hotelId) {
    registerHotelMPD(hotelId, cardMaxMPD);
  }

  const infoContainer = card.querySelector('[data-element-name="property-card-info"]');
  if (infoContainer) {
    // Clean old badges from caption tiers so only the prominent chip in property-card-info displays
    tiers.forEach((tier) => {
      tier.querySelectorAll('.aa-mpd-badge').forEach((b) => b.remove());
    });
    if (cardMaxMPD > 0) {
      const nightlyPrice = calculateNightlyPrice(effectivePrice, enriched, nights, useAllInPricing);
      if (hotelId && nightlyPrice > 0) {
        registerHotelPrice(hotelId, nightlyPrice);
      }
      createOrUpdateChip(
        infoContainer,
        cardMaxMPD,
        effectivePrice,
        enriched,
        useAllInPricing,
        undefined,
        undefined,
        true,
        nights
      );
    }
  } else if (enriched) {
    // Without a property-card-info box, the search-data rate goes on the miles line of the
    // selected earning level (the lowest line for members, the highest for status)
    const byMiles = tiers
      .map((tier) => ({ tier, miles: extractNumber(tier) || 0 }))
      .filter(({ miles }) => miles > 0)
      .sort((a, b) => a.miles - b.miles);
    const target = earningLevel === "member" ? byMiles[0]?.tier : byMiles[byMiles.length - 1]?.tier;
    tiers.forEach((tier) => {
      if (tier !== target) tier.querySelectorAll(".aa-mpd-badge").forEach((b) => b.remove());
    });
    if (target && cardMaxMPD > 0) {
      createOrUpdateChip(target, cardMaxMPD, effectivePrice, enriched, useAllInPricing, undefined, undefined, false, nights);
    }
  } else {
    // For room rows or cards without property-card-info, badge each tier element read from the card
    tiers.forEach((tier) => {
      const miles = extractNumber(tier);
      if (!miles || miles <= 0) return;
      const mpd = effectiveIsTotalPrice ? miles / effectivePrice : miles / effectivePrice / (nights || 1);
      if (isNaN(mpd) || !isFinite(mpd) || mpd <= 0) return;
      createOrUpdateChip(
        tier,
        mpd,
        effectivePrice,
        enriched,
        useAllInPricing,
        undefined,
        undefined,
        false,
        nights
      );
    });
  }

  return { cardMaxMPD, processedTiers };
}

export interface UpdateCardsOptions {
  // Use intercepted API data for card prices. Disable for room rows, whose prices differ from the
  // hotel-level price in the search payload.
  useEnrichment?: boolean;
  earningLevel?: EarningLevel;
  onProcessed?: () => void;
}

export const updateCards = (
  container: Element,
  maxMPDElem: HTMLElement,
  cardSelector: string,
  includeBonusMiles: boolean,
  useAllInPricing: boolean = true,
  optionsOrOnProcessed: UpdateCardsOptions | (() => void) = {}
): ((mutationList?: MutationRecord[]) => void) => {
  const options =
    typeof optionsOrOnProcessed === "function"
      ? { onProcessed: optionsOrOnProcessed }
      : optionsOrOnProcessed;
  const { useEnrichment = true, earningLevel = DEFAULT_EARNING_LEVEL, onProcessed } = options;
  let isScheduled = false;

  const runUpdate = () => {
    isScheduled = false;
    const nights = getNights();
    let maxMPD = 0;

    // Hide or show boost jackets based on includeBonusMiles option
    const root = container.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (root) {
      root
        .querySelectorAll<HTMLElement>(BOOST_JACKET_SELECTOR)
        .forEach((jacket) => {
          if (!includeBonusMiles) {
            jacket.style.display = "none";
          } else if (jacket.style.display === "none") {
            jacket.style.display = "";
          }
        });
    }
    updateBoostJacketStyles(includeBonusMiles);

    const cards = innermostCards(container.querySelectorAll(cardSelector));
    cards.forEach((card) => {
      try {
        const { cardMaxMPD } = processCard(
          card,
          nights,
          includeBonusMiles,
          useAllInPricing,
          useEnrichment,
          earningLevel
        );
        if (cardMaxMPD > maxMPD) {
          maxMPD = cardMaxMPD;
        }
      } catch (err) {
        console.debug('[AA-Hotels-MPD] Skipped incomplete card:', err);
      }
    });

    // Update relative dots on all cards based on current search set range
    const { minMpd, maxMpd: rangeMax } = getSearchSetMpdRange();
    const { minPrice, maxPrice } = getSearchSetPriceRange();
    if ((minMpd > 0 && rangeMax > 0) || (minPrice > 0 && maxPrice > 0)) {
      cards.forEach((card) => updateCardDots(card, minMpd, rangeMax, minPrice, maxPrice));
    }

    // Cards render lazily, so the intercepted payload may know about better rates on this page or across location
    if (useEnrichment) {
      maxMPD = Math.max(maxMPD, getLocationBestMPD(), getCurrentPageBestMPD());
    }

    if (maxMPD > 0) {
      updateSummaryBanner(maxMPDElem, maxMPD);
    } else {
      maxMPDElem.style.display = "none";
    }

    if (onProcessed) {
      try {
        onProcessed();
      } catch (err) {
        console.debug('[AA-Hotels-MPD] Error in onProcessed callback:', err);
      }
    }
  };

  return (mutationList?: MutationRecord[]) => {
    // If triggered by MutationObserver, check if mutations are solely from our own badges
    if (mutationList && mutationList.length > 0) {
      const hasExternalMutations = mutationList.some((mutation) => {
        const target = mutation.target as HTMLElement;
        if (
          target.classList?.contains('aa-mpd-badge') ||
          target.dataset?.aaMpd === 'true' ||
          target.closest?.(
            '.aa-mpd-badge, #aa-mpd-search-summary, #aa-mpd-details-summary, [data-aa-mpd], [role="listbox"]'
          )
        ) {
          return false;
        }
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const node = mutation.addedNodes[i] as HTMLElement;
          if (
            node.classList?.contains?.('aa-mpd-badge') ||
            node.dataset?.aaMpd === 'true' ||
            node.closest?.(
              '.aa-mpd-badge, #aa-mpd-search-summary, #aa-mpd-details-summary, [data-aa-mpd], [role="listbox"]'
            ) ||
            (node.getAttribute?.('role') === 'listbox' || node.getAttribute?.('role') === 'option')
          ) {
            continue;
          }
          return true;
        }
        return mutation.addedNodes.length === 0;
      });

      if (!hasExternalMutations) {
        return;
      }
    }

    // Debounce batch execution with requestAnimationFrame
    if (!isScheduled) {
      isScheduled = true;
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(runUpdate);
      } else {
        setTimeout(runUpdate, 16);
      }
    }
  };
};
