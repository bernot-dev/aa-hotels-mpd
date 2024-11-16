import { getNights } from "./nights";

export const updateCards = (container: Element, maxMPDElem: HTMLDivElement, cardSelector: string): MutationCallback => {
    const priceSelector = '[data-testid="earn-price"]';
    const tierSelector = '[data-testid$="tier-earn-rewards"]';

    return (mutationList: MutationRecord[]): number | undefined => {
        if (mutationList.every(list => list.addedNodes.length === 0)) {
            return;
        }

        const nights = getNights();
        let maxMPD = 0;

        const cards = container.querySelectorAll(cardSelector);
        cards.forEach(card => {
            const dollarsElem = card.querySelector(priceSelector);
            if (!dollarsElem) {
                return;
            }

            const dollars = extractNumber(dollarsElem);
            if (!dollars) {
                return;
            }

            const tiers = card.querySelectorAll(tierSelector);
            tiers.forEach(tier => {
                const miles = extractNumber(tier);
                if (!miles) {
                    return;
                }
                const mpd = miles/dollars/nights;
                tier.textContent += ` (${mpd.toFixed(1)}\u00A0miles/$)`;
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