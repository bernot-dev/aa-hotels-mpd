import { getNights } from "./nights";

export const updateCards = (container: Element, maxMPDElem: HTMLDivElement, cardSelector: string, includeBonusMiles: boolean): MutationCallback => {
  const priceSelector = '[data-testid="earn-price"]';
  const priceTypeSelector = '[data-testid="pricing-text"]';
  const tierSelector = '[data-testid$="tier-earn-rewards"]';

  return (mutationList: MutationRecord[]): number | undefined => {
    mutationList = mutationList.filter((list) => list.addedNodes.length > 0);
    if (mutationList.length === 0) {
      console.info("No added nodes in mutation list.");
      return;
    }

    const nights = getNights();
    let maxMPD = 0;

    const cards = container.querySelectorAll(cardSelector);
    cards.forEach(card => {
      if (card.querySelector('[data-testid="boost-tag-container"]')) {
        return;
      }
      const dollarsElem = card.querySelector(priceSelector);
      if (!dollarsElem) {
        throw new Error("Earn price not found.")
      }

      const dollars = extractNumber(dollarsElem);
      if (!dollars) {
        throw new Error("Unable to extract number from price.");
      }

      const pricingTextElem = card.querySelector(priceTypeSelector);
      if (!pricingTextElem) {
        throw new Error("Pricing text not found.");
      }
      const isTotalPrice = pricingTextElem.textContent?.startsWith("Total");

      const tiers = card.querySelectorAll(tierSelector);
      tiers.forEach(tier => {
        const miles = extractNumber(tier);
        if (!miles) {
          return;
        }
        const mpd = isTotalPrice ? miles / dollars : miles / dollars / nights;
        const mpdText = (` (${mpd.toFixed(1)}\u00A0miles/$)`);
        if (!tier.textContent?.endsWith(mpdText)) {
          tier.textContent += mpdText;
        }
        if (mpd > 20) {
          (tier as HTMLDivElement).style.color = "green";
        }
        if (mpd > maxMPD) {
          maxMPD = mpd;
        }
      });
    });
    maxMPDElem.innerHTML = `Best earn rate on this page: <b>${maxMPD.toFixed(1)} miles/$</b>.`;
    maxMPDElem.style.display = "block";
  };
}

const extractNumber = (e: Element): number | null => {
  return Number(e.textContent?.match(/[\d,]+/)?.[0]?.replace(/,/, ""));
}
