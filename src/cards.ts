import { getNights } from "./nights";
import { registerHotelMPD, getHotelIdFromCard, hotelMpdRegistry } from "./registry";

export const extractNumber = (e: Element): number | null => {
  // Ignore text inside our own injected badges when extracting original numbers
  const clone = e.cloneNode(true) as Element;
  const badges = clone.querySelectorAll('.aa-mpd-badge');
  badges.forEach((b) => b.remove());

  const match = clone.textContent?.match(/[\d,]+/)?.[0]?.replace(/,/g, "");
  return match ? Number(match) : null;
};

export interface CardProcessResult {
  cardMaxMPD: number;
  processedTiers: number;
}

export const processCard = (
  card: Element,
  nights: number,
  includeBonusMiles: boolean
): CardProcessResult => {
  const priceSelector = '[data-testid="earn-price"]';
  const priceTypeSelector = '[data-testid="pricing-text"]';
  const tierSelector = '[data-testid$="tier-earn-rewards"]';

  let cardMaxMPD = 0;
  let processedTiers = 0;

  // Respect user preference for bonus miles / boost tags
  const hasBoostTag = !!card.querySelector('[data-testid="boost-tag-container"]');
  if (hasBoostTag && !includeBonusMiles) {
    // If bonus miles are excluded, remove any previously injected badges and skip
    card.querySelectorAll('.aa-mpd-badge').forEach((b) => b.remove());
    return { cardMaxMPD: 0, processedTiers: 0 };
  }

  const dollarsElem = card.querySelector(priceSelector);
  if (!dollarsElem) {
    return { cardMaxMPD: 0, processedTiers: 0 };
  }

  const dollars = extractNumber(dollarsElem);
  if (!dollars || dollars <= 0) {
    return { cardMaxMPD: 0, processedTiers: 0 };
  }

  const pricingTextElem = card.querySelector(priceTypeSelector);
  const isTotalPrice = pricingTextElem?.textContent?.trim().startsWith("Total") ?? false;

  const tiers = card.querySelectorAll(tierSelector);
  tiers.forEach((tier) => {
    const miles = extractNumber(tier);
    if (!miles || miles <= 0) {
      return;
    }

    const mpd = isTotalPrice ? miles / dollars : miles / dollars / nights;
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
      if (mpd >= 20) {
        badge.style.color = 'green';
        badge.style.fontWeight = 'bold';
      }
      tier.appendChild(badge);
    } else {
      // Update in place only if rate changed
      if (badge.dataset.rate !== formattedMPD) {
        badge.dataset.rate = formattedMPD;
        badge.textContent = badgeText;
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
    if (mpd > cardMaxMPD) {
      cardMaxMPD = mpd;
    }
  });

  if (cardMaxMPD > 0) {
    const hotelId = getHotelIdFromCard(card);
    if (hotelId) {
      registerHotelMPD(hotelId, cardMaxMPD);
    }
  }

  return { cardMaxMPD, processedTiers };
};

export const updateCards = (
  container: Element,
  maxMPDElem: HTMLElement,
  cardSelector: string,
  includeBonusMiles: boolean
): ((mutationList?: MutationRecord[]) => void) => {
  let isScheduled = false;

  const runUpdate = () => {
    isScheduled = false;
    const nights = getNights();
    let maxMPD = 0;

    const cards = container.querySelectorAll(cardSelector);
    cards.forEach((card) => {
      try {
        const { cardMaxMPD } = processCard(card, nights, includeBonusMiles);
        if (cardMaxMPD > maxMPD) {
          maxMPD = cardMaxMPD;
        }
      } catch (err) {
        console.debug('[AA-Hotels-MPD] Skipped incomplete card:', err);
      }
    });

    if (maxMPD > 0) {
      maxMPDElem.innerHTML = `Best earn rate on this page: <b>${maxMPD.toFixed(1)} miles/$</b>.`;
      maxMPDElem.style.display = "block";
    } else if (hotelMpdRegistry.size > 0) {
      const highestCached = Math.max(...hotelMpdRegistry.values());
      if (highestCached > 0) {
        maxMPDElem.innerHTML = `Best earn rate on this page: <b>${highestCached.toFixed(1)} miles/$</b>.`;
        maxMPDElem.style.display = "block";
      }
    }
  };

  return (mutationList?: MutationRecord[]) => {
    // If triggered by MutationObserver, check if mutations are solely from our own badges
    if (mutationList && mutationList.length > 0) {
      const hasExternalMutations = mutationList.some((mutation) => {
        const target = mutation.target as HTMLElement;
        if (target.classList?.contains('aa-mpd-badge') || target.dataset?.aaMpd === 'true') {
          return false;
        }
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const node = mutation.addedNodes[i] as HTMLElement;
          if (node.classList?.contains?.('aa-mpd-badge') || node.dataset?.aaMpd === 'true') {
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
