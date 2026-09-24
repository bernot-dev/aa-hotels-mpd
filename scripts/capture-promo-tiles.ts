// Renders the Chrome Web Store promo tiles (small 440x280, marquee 1400x560) from HTML templates.
// The store requires JPEG or 24-bit PNG with no alpha, so every tile has an opaque background.
import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const projectRoot = path.resolve(__dirname, '../');
const imagesDir = path.resolve(projectRoot, 'images');

const TAGLINE = 'Find rewarding hotels.';

const dataUri = (file: string) =>
  `data:image/png;base64,${fs.readFileSync(path.join(imagesDir, file)).toString('base64')}`;

const baseCss = `
  :root {
    --navy: #0d2440;
    --navy-light: #16365c;
    --gold: #f5b82e;
    --text: #ffffff;
    --muted: #b9c8dc;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; }
  body {
    background: radial-gradient(circle at 20% 30%, var(--navy-light) 0%, var(--navy) 70%);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;
    overflow: hidden;
  }
  .name { font-weight: 800; letter-spacing: -0.02em; line-height: 1.05; }
  .name .accent { color: var(--gold); }
  .tagline { color: var(--muted); font-weight: 500; }
  .icon { filter: drop-shadow(0 10px 18px rgba(0, 0, 0, 0.35)); }
`;

const nameHtml = `AA Hotels <span class="accent">MPD</span>`;

function smallTileHtml(icon: string) {
  return `<!DOCTYPE html><html><head><style>${baseCss}
    body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; }
    .icon { width: 150px; height: 150px; margin-bottom: 2px; }
    .name { font-size: 38px; }
    .tagline { font-size: 19px; }
  </style></head><body>
    <img class="icon" src="${icon}" alt="">
    <div class="name">${nameHtml}</div>
    <div class="tagline">${TAGLINE}</div>
  </body></html>`;
}

function marqueeHtml(icon: string, screenshot: string) {
  return `<!DOCTYPE html><html><head><style>${baseCss}
    body { display: flex; align-items: center; padding-left: 90px; }
    .brand { display: flex; flex-direction: column; gap: 14px; width: 560px; flex-shrink: 0; z-index: 1; }
    .icon { width: 190px; height: 190px; margin-left: -14px; }
    .name { font-size: 76px; }
    .tagline { font-size: 34px; }
    .shot {
      position: absolute; right: -60px; top: 50%;
      width: 820px; height: 512px;
      transform: translateY(-50%) rotate(-4deg);
      border-radius: 18px; overflow: hidden;
      border: 6px solid rgba(255, 255, 255, 0.9);
      box-shadow: 0 30px 60px rgba(0, 0, 0, 0.45);
      background: url('${screenshot}') center / cover no-repeat;
    }
  </style></head><body>
    <div class="brand">
      <img class="icon" src="${icon}" alt="">
      <div class="name">${nameHtml}</div>
      <div class="tagline">${TAGLINE}</div>
    </div>
    <div class="shot"></div>
  </body></html>`;
}

async function main() {
  const icon = dataUri('icon.png');
  const screenshot = dataUri('maps-screenshot.png');

  const tiles = [
    { file: 'promo-small.png', width: 440, height: 280, html: smallTileHtml(icon) },
    { file: 'promo-marquee.png', width: 1400, height: 560, html: marqueeHtml(icon, screenshot) },
  ];

  const browser = await chromium.launch();
  for (const tile of tiles) {
    const page = await browser.newPage({ viewport: { width: tile.width, height: tile.height } });
    await page.setContent(tile.html, { waitUntil: 'load' });
    await page.screenshot({ path: path.join(imagesDir, tile.file) });
    await page.close();
    console.log(`Saved images/${tile.file} (${tile.width}x${tile.height})`);
  }
  await browser.close();
}

main().catch((err) => {
  console.error('Promo tile render failed:', err);
  process.exit(1);
});
