import { getNights } from "./nights";
import {
  registerHotelMPD,
  getHotelIdFromCard,
  getCurrentPageBestMPD,
  getEnrichedHotel,
} from "./registry";

export const extractNumber = (e: Element): number | null => {
  // Ignore text inside our own injected badges when extracting original numbers
  const clone = e.cloneNode(true) as Element;
  const badges = clone.querySelectorAll('.aa-mpd-badge');
  badges.forEach((b) => b.remove());

  const match = clone.textContent?.match(/[\d,]+/)?.[0]?.replace(/,/g, "");
  return match ? Number(match) : null;
};

export const CARD_SELECTOR = 'li.PropertyCardItem, [data-selenium="hotel-item"], [data-element-name="property-card"]';
export const ROOM_CARD_SELECTOR =
  '[data-selenium="ChildRoomsList-room"], [data-selenium="master-room-card"], [data-selenium="room-card"], [data-element-name="room-card"], .MasterRoom';
export const PRICE_SELECTOR =
  '[data-element-name="fpc-room-price"], [data-selenium="display-price"], .PropertyCardPrice__Value';
export const PRICE_TYPE_SELECTOR =
  '[data-element-name="fpc-price-text"], [data-selenium="hotel-currency"], .PropertyCardPrice__Currency';
// upc_caption is shared by the price, the price note and the miles captions; getMilesElements filters it
export const TIER_SELECTOR =
  '[data-testid="upc_caption"], [data-selenium="points-max-promo-text"], [data-selenium="points-max"], [data-selenium="loyalty-offer"]';

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

export interface CardProcessResult {
  cardMaxMPD: number;
  processedTiers: number;
}

export const processCard = (
  card: Element,
  nights: number,
  includeBonusMiles: boolean,
  useAllInPricing: boolean = true,
  useEnrichment: boolean = true
): CardProcessResult => {
  let cardMaxMPD = 0;
  let processedTiers = 0;

  // Respect user preference for bonus miles / boost tags
  const hasBoostTag = !!card.querySelector('[data-selenium="boost-tag"], [data-element-name="boost-tag"]');
  if (hasBoostTag && !includeBonusMiles) {
    // If bonus miles are excluded, remove any previously injected badges and skip
    card.querySelectorAll('.aa-mpd-badge').forEach((b) => b.remove());
    return { cardMaxMPD: 0, processedTiers: 0 };
  }

  const hotelId = getHotelIdFromCard(card);
  const enriched = hotelId && useEnrichment ? getEnrichedHotel(hotelId) : undefined;

  const dollarsElem = card.querySelector(PRICE_SELECTOR);
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

    const formattedMPD = mpd.toFixed(1);
    const badgeText = ` (${formattedMPD}\u00A0miles/$)`;

    let badge = tier.querySelector<HTMLSpanElement>('.aa-mpd-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'aa-mpd-badge';
      badge.setAttribute('data-aa-mpd', 'true');
      badge.dataset.rate = formattedMPD;
      badge.textContent = badgeText;
      if (enriched) {
        badge.setAttribute('data-pricing-type', useAllInPricing ? 'all-in' : 'base');
        if (enriched.allInPrice > 0 && enriched.allInPrice !== enriched.basePrice) {
          badge.title = `Total with taxes & fees: $${enriched.allInPrice.toFixed(2)} (Base: $${enriched.basePrice.toFixed(2)})`;
        }
      } else {
        badge.setAttribute('data-pending-api', 'true');
      }
      if (mpd >= 20) {
        badge.style.color = 'green';
        badge.style.fontWeight = 'bold';
      }
      tier.appendChild(badge);
    } else {
      // Update in place only if rate changed or upgraded from pending
      const isPending = badge.getAttribute('data-pending-api') === 'true';
      if (badge.dataset.rate !== formattedMPD || (isPending && enriched)) {
        badge.dataset.rate = formattedMPD;
        badge.textContent = badgeText;
        if (enriched) {
          badge.removeAttribute('data-pending-api');
          badge.setAttribute('data-pricing-type', useAllInPricing ? 'all-in' : 'base');
          if (enriched.allInPrice > 0 && enriched.allInPrice !== enriched.basePrice) {
            badge.title = `Total with taxes & fees: $${enriched.allInPrice.toFixed(2)} (Base: $${enriched.basePrice.toFixed(2)})`;
          }
        }
        if (mpd >= 20) {
          badge.style.color = 'green';
          badge.style.fontWeight = 'bold';
        } else {
          badge.style.color = '';
          badge.style.fontWeight = '';
        }
      }
    }

    processedTiers++;
    tierMpds.push(mpd);
  });

  // Every tier gets a badge, but the card's headline rate follows the bonus-miles setting so it
  // agrees with rates from the intercepted API: the lowest tier is what any member earns, the
  // highest includes cardmember/status bonuses.
  if (tierMpds.length > 0) {
    cardMaxMPD = includeBonusMiles ? Math.max(...tierMpds) : Math.min(...tierMpds);
  }

  if (cardMaxMPD > 0 && hotelId) {
    registerHotelMPD(hotelId, cardMaxMPD);
  }

  return { cardMaxMPD, processedTiers };
};

export interface UpdateCardsOptions {
  // Use intercepted API data for card prices. Disable for room rows, whose prices differ from the
  // hotel-level price in the search payload.
  useEnrichment?: boolean;
  onProcessed?: () => void;
}

export const updateCards = (
  container: Element,
  maxMPDElem: HTMLElement,
  cardSelector: string,
  includeBonusMiles: boolean,
  useAllInPricing: boolean = true,
  options: UpdateCardsOptions = {}
): ((mutationList?: MutationRecord[]) => void) => {
  const { useEnrichment = true, onProcessed } = options;
  let isScheduled = false;

  const runUpdate = () => {
    isScheduled = false;
    const nights = getNights();
    let maxMPD = 0;

    const cards = innermostCards(container.querySelectorAll(cardSelector));
    cards.forEach((card) => {
      try {
        const { cardMaxMPD } = processCard(card, nights, includeBonusMiles, useAllInPricing, useEnrichment);
        if (cardMaxMPD > maxMPD) {
          maxMPD = cardMaxMPD;
        }
      } catch (err) {
        console.debug('[AA-Hotels-MPD] Skipped incomplete card:', err);
      }
    });

    // Cards render lazily, so the intercepted payload may know about better rates on this page
    if (useEnrichment) {
      maxMPD = Math.max(maxMPD, getCurrentPageBestMPD());
    }

    if (maxMPD > 0) {
      const html = `Best earn rate on this page: <b>${maxMPD.toFixed(1)} miles/$</b>.`;
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
            '#downshift-0-menu, [role="listbox"], [data-testid*="search-destination"], #downshift-0-input'
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
              '#downshift-0-menu, [role="listbox"], [data-testid*="search-destination"], #downshift-0-input'
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
