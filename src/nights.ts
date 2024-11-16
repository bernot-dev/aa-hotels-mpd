// Get the number of nights
export const getNights = (): number => {
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
}
