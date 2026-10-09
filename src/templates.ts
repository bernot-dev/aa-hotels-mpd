import { getLogoUrl } from "./logo";
import { getMpdDot } from "./registry";

export const createMilesPerDollarElement = (mpd: number): Element => {
  const elem = document.createElement("span");
  elem.className = "aa-mpd-badge aa-mpd-chip";
  elem.setAttribute("data-aa-mpd", "true");
  elem.dataset.rate = mpd.toFixed(1);
  const dot = getMpdDot(mpd);
  elem.dataset.dot = dot;

  if (mpd >= 20) {
    elem.style.color = "green";
    elem.style.fontWeight = "bold";
    elem.classList.add("aa-mpd-high-rate");
  }

  const logoUrl = getLogoUrl(32);
  elem.innerHTML = `<img class="aa-mpd-chip-icon" src="${logoUrl}" alt="" aria-hidden="true" width="18" height="18" /> <span class="aa-mpd-chip-rate">${dot} ${mpd.toFixed(1)} mpd</span>`;
  return elem;
};
