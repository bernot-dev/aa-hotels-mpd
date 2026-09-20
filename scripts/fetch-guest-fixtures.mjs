import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const fixturesDir = path.resolve(projectRoot, 'fixtures');

if (!fs.existsSync(fixturesDir)) {
  fs.mkdirSync(fixturesDir, { recursive: true });
}

const FIRECRAWL_URL = process.env.FIRECRAWL_URL || 'https://firecrawl.bernot.io';

const TARGET_URLS = {
  'search-guest.html': 'https://www.aadvantagehotels.com/search?latitude=32.7767&longitude=-96.7970&destination=Dallas%2C%20TX%2C%20USA&checkIn=2026-10-05&checkOut=2026-10-07&rooms=1&adults=2&seamless_auth=1',
  'details-guest.html': 'https://www.aadvantagehotels.com/details?adults=2&checkIn=2026-10-05&checkOut=2026-10-07&destination=Dallas%2C%20TX%2C%20USA&ePrice=561&eRewards=400&id=1998796&latitude=32.7767&longitude=-96.7970&rea=true&rooms=1&searchId=c00ad7e4-efc2-47f5-afea-3b0bfd655af5&sort=featured&seamless_auth=1'
};

async function fetchFixture(filename, url) {
  console.log(`Fetching fixture for ${filename} from ${url}...`);
  const response = await fetch(`${FIRECRAWL_URL}/v1/scrape`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      waitFor: 8000,
      formats: ['html']
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch from Firecrawl: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  if (!result.success || !result.data?.html) {
    throw new Error(`Firecrawl scrape unsuccessful: ${JSON.stringify(result)}`);
  }

  const filePath = path.join(fixturesDir, filename);
  fs.writeFileSync(filePath, result.data.html, 'utf-8');
  console.log(`Saved ${filename} (${(result.data.html.length / 1024).toFixed(1)} KB)`);
}

async function main() {
  for (const [filename, url] of Object.entries(TARGET_URLS)) {
    try {
      await fetchFixture(filename, url);
    } catch (err) {
      console.error(`Error fetching ${filename}:`, err.message);
    }
  }
}

main();
