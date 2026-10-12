# Agent notes

## Browser automation

The dev box has about 4 GB of RAM, and `/tmp` is RAM-backed tmpfs. Chromium profiles left in `/tmp` by killed Playwright scripts have filled memory and set off the OOM killer.

- Any Playwright script, including one-off probes, must get its profile from `createBrowserProfile()` in `scripts/browser-profile.mjs` and pass `profile.env` to the launch call:

  ```js
  // From a script outside the repo, import both from absolute paths in the repo.
  import { chromium } from '/home/adam/bernot-dev/aa-hotels-mpd/node_modules/@playwright/test/index.mjs';
  import { createBrowserProfile } from '/home/adam/bernot-dev/aa-hotels-mpd/scripts/browser-profile.mjs';

  const profile = createBrowserProfile('probe');
  const context = await chromium.launchPersistentContext(profile.dir, { env: profile.env, headless: true });
  ```

  This keeps the profile on disk and deletes it on exit, Ctrl-C, or `timeout`. Don't `mkdtemp` a profile in `os.tmpdir()`.
- Write probe scripts, screenshots, and other scratch output to your session scratchpad, not to `/tmp`, and delete them when you're done.
- Run `npm run clean:browser` after a session that killed browsers.
