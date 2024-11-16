/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./src/cards.ts":
/*!**********************!*\
  !*** ./src/cards.ts ***!
  \**********************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.updateCards = void 0;
const nights_1 = __webpack_require__(/*! ./nights */ "./src/nights.ts");
const updateCards = (container, maxMPDElem, cardSelector) => {
    const priceSelector = '[data-testid="earn-price"]';
    const tierSelector = '[data-testid$="tier-earn-rewards"]';
    return (mutationList) => {
        if (mutationList.every(list => list.addedNodes.length === 0)) {
            return;
        }
        const nights = (0, nights_1.getNights)();
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
                const mpd = miles / dollars / nights;
                tier.textContent += ` (${mpd.toFixed(1)}\u00A0miles/$)`;
                if (mpd > 20) {
                    tier.style.color = "green";
                }
                if (mpd > maxMPD) {
                    maxMPD = mpd;
                }
            });
        });
        maxMPDElem.innerHTML = `Best earn rate on this page: <b>${maxMPD.toFixed(1)} miles/$</b>.`;
        maxMPDElem.style.display = "block";
    };
};
exports.updateCards = updateCards;
const extractNumber = (e) => {
    var _a, _b, _c;
    return Number((_c = (_b = (_a = e.textContent) === null || _a === void 0 ? void 0 : _a.match(/[\d,]+/)) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.replace(/,/, ""));
};


/***/ }),

/***/ "./src/details.ts":
/*!************************!*\
  !*** ./src/details.ts ***!
  \************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.processDetailsPage = void 0;
const cards_1 = __webpack_require__(/*! ./cards */ "./src/cards.ts");
const processDetailsPage = (container) => {
    const maxMPDElem = document.createElement("div");
    maxMPDElem.style.background = "yellow";
    maxMPDElem.style.padding = "20px";
    maxMPDElem.style.margin = "20px";
    maxMPDElem.style.display = "none";
    const cardSelector = '[data-testid="room-card"]';
    const callback = (0, cards_1.updateCards)(container, maxMPDElem, cardSelector);
    const observer = new MutationObserver(callback);
    observer.observe(container, { childList: true });
    container.insertAdjacentElement("beforebegin", maxMPDElem);
};
exports.processDetailsPage = processDetailsPage;


/***/ }),

/***/ "./src/nights.ts":
/*!***********************!*\
  !*** ./src/nights.ts ***!
  \***********************/
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getNights = void 0;
const getNights = () => {
    const checkInDate = new URLSearchParams(window.location.search).get("checkIn");
    if (!checkInDate) {
        throw new Error("Check in date not found!");
    }
    const checkOutDate = new URLSearchParams(window.location.search).get("checkOut");
    if (!checkOutDate) {
        throw new Error("Check out date not found!");
    }
    const dayInMs = 1000 * 60 * 60 * 24;
    return Math.round((Date.parse(checkOutDate) - Date.parse(checkInDate)) / dayInMs);
};
exports.getNights = getNights;


/***/ }),

/***/ "./src/search.ts":
/*!***********************!*\
  !*** ./src/search.ts ***!
  \***********************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.processSearchPage = void 0;
const cards_1 = __webpack_require__(/*! ./cards */ "./src/cards.ts");
const processSearchPage = (container) => {
    const maxMPDElem = document.createElement("div");
    maxMPDElem.style.background = "yellow";
    maxMPDElem.style.padding = "20px";
    maxMPDElem.style.margin = "20px";
    maxMPDElem.style.display = "none";
    const cardSelector = '[data-testid="earn-pricing-aadvantage"]';
    const callback = (0, cards_1.updateCards)(container, maxMPDElem, cardSelector);
    const observer = new MutationObserver(callback);
    observer.observe(container, { childList: true });
    container.insertAdjacentElement("beforebegin", maxMPDElem);
};
exports.processSearchPage = processSearchPage;


/***/ }),

/***/ "./src/wait.ts":
/*!*********************!*\
  !*** ./src/wait.ts ***!
  \*********************/
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.waitForElement = void 0;
const waitForElement = (elementSelector) => {
    return new Promise(resolve => {
        let elem = document.querySelector(elementSelector);
        if (elem) {
            return resolve(elem);
        }
        const observer = new MutationObserver(() => {
            elem = document.querySelector(elementSelector);
            if (elem) {
                observer.disconnect();
                resolve(elem);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    });
};
exports.waitForElement = waitForElement;


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be isolated against other modules in the chunk.
(() => {
var exports = __webpack_exports__;
/*!**********************!*\
  !*** ./src/index.ts ***!
  \**********************/

Object.defineProperty(exports, "__esModule", ({ value: true }));
const wait_1 = __webpack_require__(/*! ./wait */ "./src/wait.ts");
const details_1 = __webpack_require__(/*! ./details */ "./src/details.ts");
const search_1 = __webpack_require__(/*! ./search */ "./src/search.ts");
const detailsSelector = "#rooms-table";
(0, wait_1.waitForElement)(detailsSelector).then(details_1.processDetailsPage).catch(console.error);
const searchSelector = '[data-testid="hotel-results-list-container"]';
(0, wait_1.waitForElement)(searchSelector).then(search_1.processSearchPage).catch(console.error);

})();

/******/ })()
;
//# sourceMappingURL=content.js.map