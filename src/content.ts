const selector: Record<string, string> = {
	'hotelCard': '[data-testid="earn-pricing-aadvantage"]',
	'resultsContainer': '[data-testid="hotel-results-list-container"]',
	'price': '[data-testid="earn-price"]',
	'maxEarnRate': '#max-earn-rate',
	'tier': '[data-testid$="tier-earn-rewards"]'
}

const createMilesPerDollarElement = (mpd: number) => {
	const elem = document.createElement("div");
	if (mpd >= 20) {
		elem.setAttribute("style", "color: green;");
	}
	const mpdFixed = mpd.toFixed(1);
	elem.innerText = `${mpdFixed} miles/$`;
	return elem; 
}

const createMaxMilesPerDollarElement = (mpd: number) => {
	let elem = document.querySelector(selector.maxEarnRate);

	if (!elem) {
		elem = document.createElement("div");
		elem.id = "max-earn-rate";
		let container = document.querySelector(selector.resultsContainer);
		container?.insertAdjacentElement('beforebegin', elem);
	}

	const mpdFixed = mpd.toFixed(1);
	elem.textContent = `Maximum of ${mpdFixed} miles/$ for this search.`;
}

const getNights = (): number => {
	const checkInDate = (document.getElementById('check-in-date') as HTMLInputElement)?.value ?? 1;
	const checkOutDate = (document.getElementById('check-out-date') as HTMLInputElement)?.value;
	const dayInMs = 1000 * 60 * 60 * 24;

	return Math.round((Date.parse(checkOutDate) - Date.parse(checkInDate)) / dayInMs);
}

const extractNumber = (e: Element): number | null => {
	return Number(e.textContent?.match(/[\d,]+/)?.[0]?.replaceAll(",", ""));
}

// Run query across page with results to calculate miles per dollar.
const showMilesPerDollar = (resultsListContainer: Element) => {
	const nights = getNights();
	const hotelCards = document.querySelectorAll(selector.hotelCard);
	if (hotelCards.length === 0) {
		console.debug("No hotels found in results.");
		return;
	}

	console.log('Calculating MPD for '+hotelCards.length+' hotels');

	let maxMPD = 0;

	for (const hotelCard of hotelCards) {
		const dollarsElem = hotelCard.querySelector(selector.price);
		if (!dollarsElem) {
			console.error("earn-price not found");	
			return;
		}
		const dollars = extractNumber(dollarsElem);
		if (!dollars) {
			continue;
		}

		const milesElems = hotelCard.querySelectorAll(selector.tier);
		for (const milesElem of milesElems) {
			if (!milesElem) {
				console.error("could not find tier-earn-rewards or non-tier-earn-rewards");
				return;
			}
			const miles = extractNumber(milesElem);
			if (!miles) {
				continue;
			}

			const mpd = miles/dollars/nights;
			if (mpd > maxMPD) {
				maxMPD = mpd;
			}
			milesElem.insertAdjacentElement('beforeend', createMilesPerDollarElement(mpd));
		}
	}
	
	createMaxMilesPerDollarElement(maxMPD);
	console.info(`Maximum miles per dollar: ${maxMPD}`);
}

// Watch for changes to results list.
const observeResultsList = (resultsListContainer: Element) => {
	showMilesPerDollar(resultsListContainer);

	const observer = new MutationObserver(mutationList => {
		showMilesPerDollar(resultsListContainer);
	});
	observer.observe(resultsListContainer, { childList: true });
}

const waitForElem = (elementSelector: string): Promise<Element> => {
	console.debug(`Waiting for element: ${elementSelector}`);
	return new Promise(resolve => {
		let elem = document.querySelector(elementSelector);
		if (elem) {
			return resolve(elem);
		}

		const observer = new MutationObserver(mutations => {
			elem = document.querySelector(elementSelector);
		
			if (elem) {
				observer.disconnect();
				resolve(elem);
			}
		});
		observer.observe(document.body, {childList: true, subtree: true});
	})
}

waitForElem(selector.resultsContainer)
	.then((resultsContainer: Element) => {
		observeResultsList(resultsContainer);
	})
	.catch(console.error);

