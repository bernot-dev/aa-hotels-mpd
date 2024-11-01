const selector = {
	'hotelCard': '[data-testid="earn-pricing-aadvantage"]',
	'resultsContainer': '[data-testid="hotel-results-list-container"]',
	'price': '[data-testid="earn-price"]',
	'tier': '[data-testid$="tier-earn-rewards"]'
}

const milesPerDollarElement(mpd) {
	
}

// Run query across page with results to calculate miles per dollar.
const showMilesPerDollar = () => {
	const checkInDate = document.getElementById('check-in-date')?.value;
	const checkOutDate = document.getElementById('check-out-date')?.value;
	const dayInMs = 1000 * 60 * 60 * 24;

	const nights = Math.round((Date.parse(checkOutDate) - Date.parse(checkInDate)) / dayInMs);

	const hotelCards = document.querySelectorAll(selector.hotelCard);
	if (hotelCards.length === 0) {
		console.debug("No hotels found in results.");
		return;
	}

	console.log('Calculating MPD for '+hotelCards.length+' hotels');

	let maxMPD = 0;

	for (const hotelCard of hotelCards) {
		const milesElem = hotelCard.querySelector(selector.tier);
		if (!milesElem) {
			console.error("could not find tier-earn-rewards or non-tier-earn-rewards");
			return;
		}
		const miles = Number(milesElem.innerText.match(/[\d,]+/)[0].replaceAll(",", ""));

		const dollarsElem = hotelCard.querySelector(selector.price);
		if (!dollarsElem) {
			console.error("earn-price not found");	
			return;
		}
		const dollars = Number(dollarsElem.innerText.match(/[\d,]+/)[0].replaceAll(",", ""));

		const mpd = miles/dollars/nights;
		if (mpd > maxMPD) {
			maxMPD = mpd;
		}
		const mpdFixed = mpd.toFixed(1);
		dollarsElem.insertAdjacentText('beforebegin', `${mpdFixed} miles/$`);
	}
	console.info(`Maximum miles per dollar: ${maxMPD}`);
}

// Watch for changes to results list.
const observeResultsList = (resultsListContainer) => {
	showMilesPerDollar();

	const observer = new MutationObserver(mutationList => {
		showMilesPerDollar();
	});
	observer.observe(resultsListContainer, { childList: true });
}

const waitForElem = (sel) => {
	console.debug(`Waiting for element: ${sel}`);
	return new Promise(resolve => {
		let elem = document.querySelector(sel);
		if (elem) {
			return resolve(elem);
		}

		const observer = new MutationObserver(mutations => {
			elem = document.querySelector(sel);
		
			if (elem) {
				observer.disconnect();
				resolve(elem);
			}
		});
		observer.observe(document.body, {childList: true, subtree: true});
	})
}

waitForElem(selector.resultsContainer)
	.then((resultsContainer) => {
		observeResultsList(resultsContainer);
	})
	.catch(console.error);

