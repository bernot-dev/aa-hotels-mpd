import { waitForElement } from "./wait";
import { processDetailsPage } from "./details";
import { processSearchPage } from "./search";

const detailsSelector = 'div[data-testid="room-group"]';
waitForElement(detailsSelector).then(processDetailsPage).catch(console.error);

const searchSelector = '[data-testid="hotel-results-list-container"]';
waitForElement(searchSelector).then(processSearchPage).catch(console.error);
