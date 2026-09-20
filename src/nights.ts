// Get the number of nights safely with fallbacks

export const getNights = (): number => {
  const params = new URLSearchParams(window.location.search);
  const checkInStr = params.get("checkIn") || params.get("checkin");
  const checkOutStr = params.get("checkOut") || params.get("checkout");

  const dayInMs = 1000 * 60 * 60 * 24;

  if (checkInStr && checkOutStr) {
    const checkInMs = Date.parse(checkInStr);
    const checkOutMs = Date.parse(checkOutStr);
    if (!isNaN(checkInMs) && !isNaN(checkOutMs)) {
      const nights = Math.round((checkOutMs - checkInMs) / dayInMs);
      if (nights > 0) {
        return nights;
      }
    }
  }

  // Fallback: check DOM inputs if present
  try {
    const checkInInput = document.querySelector<HTMLInputElement>('#check-in-date')?.value;
    const checkOutInput = document.querySelector<HTMLInputElement>('#check-out-date')?.value;
    if (checkInInput && checkOutInput) {
      const inMs = Date.parse(checkInInput);
      const outMs = Date.parse(checkOutInput);
      if (!isNaN(inMs) && !isNaN(outMs)) {
        const nights = Math.round((outMs - inMs) / dayInMs);
        if (nights > 0) {
          return nights;
        }
      }
    }
  } catch {
    // Ignore DOM query failures
  }

  // Default to 1 night if dates cannot be parsed
  return 1;
};
