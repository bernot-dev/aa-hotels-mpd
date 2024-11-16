export const createMilesPerDollarElement = (mpd: number): Element => {
	const elem = document.createElement("div");
	if (mpd >= 20) {
		elem.setAttribute("style", "color: green;");
	}
	const mpdFixed = mpd.toFixed(1);
	elem.innerText = `${mpdFixed} miles/$`;
	return elem; 
}
