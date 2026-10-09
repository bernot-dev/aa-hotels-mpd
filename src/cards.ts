import { getNights } from "./nights";
import {
  registerHotelMPD,
  getHotelIdFromCard,
  getCurrentPageBestMPD,
  getEnrichedHotel,
  getMpdDot,
  getSearchSetMpdRange,
} from "./registry";
import {
  applyAllInPrice,
  candidatesFromHotel,
  candidatesFromRoom,
  readMemberMiles,
  readShownPrice,
} from "./allin";
import { getLogoUrl } from "./logo";
import { DEFAULT_EARNING_LEVEL, EarningLevel, milesForEarningLevel } from "./settings";
import type { EnrichedHotelRate } from "./interceptor";

export const extractNumber = (e: Element): number | null => {
  // Ignore text inside our own injected badges when extracting original numbers
  const clone = e.cloneNode(true) as Element;
  const badges = clone.querySelectorAll('.aa-mpd-badge');
  badges.forEach((b) => b.remove());

  const match = clone.textContent?.match(/[\d,]+/)?.[0]?.replace(/,/g, "");
  return match ? Number(match) : null;
};

export const CARD_SELECTOR =
  'li.PropertyCardItem, [data-selenium="hotel-item"], [data-element-name="property-card"], [data-testid="hotel-card-pricing"], [data-testid="room-card"]';
export const ROOM_CARD_SELECTOR =
  '[data-selenium="ChildRoomsList-room"], [data-selenium="master-room-card"], [data-selenium="room-card"], [data-element-name="room-card"], .MasterRoom';
export const PRICE_SELECTOR =
  '[data-element-name="fpc-room-price"], [data-selenium="display-price"], .PropertyCardPrice__Value, [data-testid="earn-price"]';
export const PRICE_TYPE_SELECTOR =
  '[data-element-name="fpc-price-text"], [data-selenium="hotel-currency"], .PropertyCardPrice__Currency, [data-testid="pricing-text"]';
// upc_caption is shared by the price, the price note and the miles captions; getMilesElements filters it
export const TIER_SELECTOR =
  '[data-testid="upc_caption"], [data-selenium="points-max-promo-text"], [data-selenium="points-max"], [data-selenium="loyalty-offer"], [data-testid$="tier-earn-rewards"]';

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
      gap: 7px !important;
      padding: 6px 14px !important;
      border-radius: 9999px !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
      font-size: 13px !important;
      font-weight: 600 !important;
      line-height: 1.2 !important;
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
      margin-top: 12px !important;
      margin-bottom: 4px !important;
    }

    [data-testid="upc_caption"] .aa-mpd-chip,
    [data-selenium^="points-max"] .aa-mpd-chip {
      margin-left: 6px !important;
      padding: 3px 10px !important;
      font-size: 12px !important;
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

    .aa-mpd-chip-icon {
      width: 18px !important;
      height: 18px !important;
      object-fit: contain !important;
      flex-shrink: 0 !important;
      display: inline-block !important;
      vertical-align: middle !important;
    }

    .aa-mpd-chip-price {
      font-weight: 700 !important;
      color: #0d2440 !important;
    }

    .aa-mpd-chip-sep {
      opacity: 0.4 !important;
      font-size: 12px !important;
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
      align-items: center;
      gap: 12px;
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

    .aa-mpd-banner-text b,
    .aa-mpd-banner-text strong {
      color: #004b87 !important;
      font-weight: 700 !important;
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
  includePrice: boolean = true
): HTMLElement {
  ensureChipStyles();

  const formattedMPD = mpd.toFixed(1);
  const dot = getMpdDot(mpd, minMpd, maxMpd);
  const logoUrl = getLogoUrl(32);
  const allInPrice = (enriched && enriched.allInPrice > 0) ? enriched.allInPrice : price;

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

  if (enriched) {
    chip.removeAttribute('data-pending-api');
    chip.setAttribute('data-pricing-type', useAllInPricing ? 'all-in' : 'base');
    if (enriched.allInPrice > 0 && enriched.allInPrice !== enriched.basePrice) {
      chip.title = `Total with taxes & fees: $${enriched.allInPrice.toFixed(2)} (Base: $${enriched.basePrice.toFixed(2)})`;
    }
  } else {
    chip.setAttribute('data-pending-api', 'true');
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

  const priceFormatted = (includePrice && allInPrice > 0)
    ? `$${allInPrice % 1 === 0 ? allInPrice.toLocaleString() : allInPrice.toFixed(2)} all-in`
    : '';

  const newHtml = [
    `<img class="aa-mpd-chip-icon" src="${logoUrl}" alt="" aria-hidden="true" width="18" height="18" />`,
    priceFormatted ? `<span class="aa-mpd-chip-price">${priceFormatted}</span>` : '',
    priceFormatted ? `<span class="aa-mpd-chip-sep">•</span>` : '',
    `<span class="aa-mpd-chip-rate">${dot} ${formattedMPD} mpd</span>`,
  ]
    .filter(Boolean)
    .join(' ');

  if (chip.innerHTML !== newHtml) {
    chip.innerHTML = newHtml;
  }

  return chip;
}

export function updateCardDots(card: Element, minMpd: number, maxMpd: number): void {
  const chips = card.querySelectorAll<HTMLElement>('.aa-mpd-badge');
  chips.forEach((chip) => {
    const rate = Number(chip.dataset.rate);
    if (isNaN(rate) || rate <= 0) return;

    const dot = getMpdDot(rate, minMpd, maxMpd);
    if (chip.dataset.dot === dot) return;
    chip.dataset.dot = dot;

    const rateSpan = chip.querySelector('.aa-mpd-chip-rate');
    if (rateSpan) {
      const newText = `${dot} ${rate.toFixed(1)} mpd`;
      if (rateSpan.textContent !== newText) {
        rateSpan.textContent = newText;
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
  // cards match by hotel id; details room rates have no id and match by price and member miles.
  if (useAllInPricing && dollarsElem) {
    const shown = readShownPrice(dollarsElem);
    const candidates = enriched
      ? candidatesFromHotel(enriched)
      : shown !== null
      ? candidatesFromRoom(shown, readMemberMiles(card))
      : null;
    applyAllInPrice(dollarsElem, candidates, card);
  }

  // Respect user preference for bonus miles / boost tags
  const hasBoostTag = !!card.querySelector('[data-selenium="boost-tag"], [data-element-name="boost-tag"]');
  if (hasBoostTag && !includeBonusMiles) {
    // If bonus miles are excluded, remove any previously injected badges and skip
    card.querySelectorAll('.aa-mpd-badge').forEach((b) => b.remove());
    return { cardMaxMPD: 0, processedTiers: 0 };
  }

  const domDollars = dollarsElem ? extractPrice(dollarsElem) : null;

  // If no DOM price and no API price, cannot process
  if ((!domDollars || domDollars <= 0) && !enriched) {
    return { cardMaxMPD: 0, processedTiers: 0 };
  }

  const pricingTextElem = card.querySelector(PRICE_TYPE_SELECTOR);
  const isTotalPrice = isTotalPriceText(pricingTextElem?.textContent || "");

  // Determine authoritative pricing
  const effectivePrice = enriched
    ? (useAllInPricing && enriched.allInPrice > 0
        ? enriched.allInPrice
        : (enriched.basePrice > 0 ? enriched.basePrice : (domDollars && domDollars > 0 ? domDollars : enriched.price)))
    : (domDollars || 0);

  if (effectivePrice <= 0) {
    return { cardMaxMPD: 0, processedTiers: 0 };
  }

  // If we have API data with an all-in total or base total, it's inherently total stay price
  const effectiveIsTotalPrice = enriched ? (enriched.allInPrice > 0 || enriched.basePrice > 0 || isTotalPrice) : isTotalPrice;

  const tierMpds: number[] = [];
  const tiers = getMilesElements(card);
  tiers.forEach((tier) => {
    const miles = extractNumber(tier);
    if (!miles || miles <= 0) {
      return;
    }

    const mpd = effectiveIsTotalPrice ? miles / effectivePrice : miles / effectivePrice / (nights || 1);
    if (isNaN(mpd) || !isFinite(mpd) || mpd <= 0) {
      return;
    }

    tierMpds.push(mpd);
  });

  if (tierMpds.length > 0) {
    cardMaxMPD = earningLevel === "member" ? Math.min(...tierMpds) : Math.max(...tierMpds);
    processedTiers = tierMpds.length;
  } else if (enriched) {
    const miles = milesForEarningLevel(enriched.baseMiles, enriched.tieredMiles, earningLevel);
    if (miles > 0) {
      const mpd = miles / effectivePrice;
      if (!isNaN(mpd) && isFinite(mpd) && mpd > 0) {
        cardMaxMPD = mpd;
        processedTiers = 1;
      }
    }
  }

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
      createOrUpdateChip(
        infoContainer,
        cardMaxMPD,
        effectivePrice,
        enriched,
        useAllInPricing,
        undefined,
        undefined,
        true
      );
    }
  } else {
    // For room rows or cards without property-card-info, badge each tier element
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
        false
      );
    });
  }

  return { cardMaxMPD, processedTiers };
};

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
    if (minMpd > 0 && rangeMax > 0) {
      cards.forEach((card) => updateCardDots(card, minMpd, rangeMax));
    }

    // Cards render lazily, so the intercepted payload may know about better rates on this page
    if (useEnrichment) {
      maxMPD = Math.max(maxMPD, getCurrentPageBestMPD());
    }

    if (maxMPD > 0) {
      const logoUrl = getLogoUrl(32);
      const html = `<img class="aa-mpd-banner-logo" src="${logoUrl}" alt="" aria-hidden="true" width="28" height="28" /><span class="aa-mpd-banner-text">Best earn rate on this page: <b>${maxMPD.toFixed(1)} miles/$</b>.</span>`;
      if (maxMPDElem.innerHTML !== html) maxMPDElem.innerHTML = html;
      maxMPDElem.style.display = "block";
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
            '.aa-mpd-badge, #aa-mpd-search-summary, #aa-mpd-details-summary, [data-aa-mpd], #downshift-0-menu, [role="listbox"], [data-testid*="search-destination"], #downshift-0-input'
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
              '.aa-mpd-badge, #aa-mpd-search-summary, #aa-mpd-details-summary, [data-aa-mpd], #downshift-0-menu, [role="listbox"], [data-testid*="search-destination"], #downshift-0-input'
            ) ||
            (node.id && node.id.includes('downshift')) ||
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
