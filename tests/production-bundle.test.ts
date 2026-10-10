// The committed dist/ is what gets packaged and released, so it must be a production build: debug
// tooling is for development builds only (npm run build:dev, npm run watch). Rebuild with
// `npm run build` before committing.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve(__dirname, '../dist');
const DEBUG_MARKERS = [
  'aa-mpd-debug-panel',
  'showDebugButton',
  'aa_mpd_debug_network',
  'AA_HOTELS_MPD_DEBUG_RECORDS',
];

describe('committed production bundle', () => {
  for (const bundle of ['content.js', 'interceptor.js', 'background.js', 'options.js']) {
    it(`leaves the debug tooling out of dist/${bundle}`, () => {
      const code = fs.readFileSync(path.join(distDir, bundle), 'utf-8');
      for (const marker of DEBUG_MARKERS) expect(code).not.toContain(marker);
    });
  }
});
