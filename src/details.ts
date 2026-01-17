import { updateCards } from "./cards";

export const processDetailsPage = (container: Element) => {
  if (container.parentElement === null) {
    console.error("No parent element of room groups on details page.");
  } else {
    container = container.parentElement;
  }

  const maxMPDElem = document.createElement("div");
  maxMPDElem.style.background = "yellow";
  maxMPDElem.style.padding = "20px";
  maxMPDElem.style.margin = "20px";
  maxMPDElem.style.display = "none";

  chrome.storage.sync.get(['expandRoomRates', 'expandRoomTypes', 'includeBonusMiles'], (result) => {
    const cardSelector = '[data-testid="room-card"]';
    const callback = updateCards(container, maxMPDElem, cardSelector, result.includeBonusMiles);
    const observer = new MutationObserver(callback);
    observer.observe(container, { childList: true, subtree: true });

    if (result.expandRoomTypes) {
      let moreGroupsButton: HTMLButtonElement | null = document.querySelector('button[data-testid="rooms-table-see-more-button"]');
      while (moreGroupsButton) {
        moreGroupsButton.click();
        moreGroupsButton = document.querySelector('button[data-testid="rooms-table-see-more-button"]');
      }
    }

    if (result.expandRoomRates) {
      (document.querySelectorAll('button[data-testid="room-group-see-more-toggle"]') as NodeListOf<HTMLButtonElement>).forEach((button) => button.click());
    }

    // Manually trigger once.
    const addedNodes = document.querySelectorAll(cardSelector);
    callback([{ addedNodes: addedNodes as NodeList }] as MutationRecord[], observer);
    container.insertAdjacentElement("beforebegin", maxMPDElem);
  });
}
