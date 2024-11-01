const showMilesPerDollar = () => {
	const checkInDate = document.getElementById('check-in-date').value;
	const checkOutDate = document.getElementById('check-out-date').value;
	const dayInMs = 1000 * 60 * 60 * 24;

	const nights = Math.round((checkOutDate - checkInDate) / dayInMs);

	const hotelCards = document.querySelectorAll('[data-testid="earn-pricing-aadvantage"]');

	for (const hotelCard of hotelCards) {
		const milesElem = hotelCard.querySelector('[data-testid="tier-earn-rewards"]');
		const miles = Number(milesElem.innerText.match(/[\d,]+/)[0].replaceAll(",", ""));

		const dollarsElem = hotelCard.querySelector('[data-testid="earn-price"]');
		const dollars = Number(dollarsElem.innerText.match(/[\d,]+/)[0].replaceAll(",", ""));

		const mpd = (miles/dollars).toFixed(1);
		dollarsElem.insertAdjacentText('beforebegin', `${mpd} miles/$`);
	}
}

setTimeout(() => {
	showMilesPerDollar();
}, 5000);
