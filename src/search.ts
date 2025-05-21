import { updateCards } from "./cards";

export const processSearchPage = (container: Element) => {
    const maxMPDElem = document.createElement("div");
	maxMPDElem.style.background = "yellow";
	maxMPDElem.style.padding = "20px";
	maxMPDElem.style.margin = "20px";
	maxMPDElem.style.display = "none";

    const cardSelector = '[data-testid="hotel-card-pricing"]';
    const callback = updateCards(container, maxMPDElem, cardSelector);
    const observer = new MutationObserver(callback);
    observer.observe(container, {childList: true});

    container.insertAdjacentElement("beforebegin", maxMPDElem);
}
