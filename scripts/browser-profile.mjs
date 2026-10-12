// Throwaway Chromium profiles for Playwright scripts and tests.
//
// /tmp on the dev box is RAM-backed tmpfs, and Agoda pages leave 15-50 MB profiles behind. Scripts
// that are killed (timeout, Ctrl-C, OOM) never reach their `finally`, so leftovers pile up until the
// machine runs out of memory. This helper keeps profiles on disk under ~/.cache, points Chromium's
// own temp files (org.chromium.Chromium.*) inside the profile, removes the profile on exit or
// SIGINT/SIGTERM/SIGHUP, and sweeps profiles left behind by processes that are gone.
//
//   const profile = createBrowserProfile('aa-fixtures');
//   const context = await chromium.launchPersistentContext(profile.dir, { env: profile.env, ... });
//   try { ... } finally { await context.close(); profile.cleanup(); }
//
// `node scripts/browser-profile.mjs --clean` also deletes old Chromium/Playwright leftovers in /tmp.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
export const PROFILES_ROOT = path.join(cacheHome, 'aa-hotels-mpd', 'profiles');

// Chromium puts its singleton socket at $TMPDIR/org.chromium.Chromium.XXXXXX/SingletonSocket and aborts
// when that passes the 107-byte Unix socket limit, so only redirect TMPDIR when the path fits.
const MAX_TMPDIR_LENGTH = 107 - '/org.chromium.Chromium.XXXXXX/SingletonSocket'.length;

// Temp entries that Chromium, Playwright and earlier ad-hoc probe scripts create in /tmp.
const TMP_LEFTOVERS = /^(org\.chromium\.Chromium\.|playwright[-_]|pw-(ext|cert)-|aa-|chromedp-)/;
const TMP_MIN_AGE_MS = 60 * 60 * 1000;

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const live = new Set();
let handlersInstalled = false;

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function removeAll() {
  for (const dir of live) fs.rmSync(dir, { recursive: true, force: true });
}

function installHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;
  process.on('exit', removeAll);
  for (const signal of SIGNALS) {
    // Playwright's SIGTERM/SIGHUP handlers close the browser but leave exiting to the script, and any
    // listener disables Node's default exit-on-signal. Give the browser a moment to close, then exit
    // as the signal would have; the exit handler removes the profiles.
    process.on(signal, () => setTimeout(() => process.exit(128 + os.constants.signals[signal]), 2000));
  }
}

/** Deletes profiles whose owning process has exited. Returns the number removed. */
export function sweepStaleProfiles() {
  let removed = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(PROFILES_ROOT);
  } catch {
    return 0;
  }
  for (const name of entries) {
    const pid = Number(name.match(/-(\d+)-[^-]+$/)?.[1]);
    if (pid && isAlive(pid)) continue;
    fs.rmSync(path.join(PROFILES_ROOT, name), { recursive: true, force: true });
    removed++;
  }
  return removed;
}

/** Deletes Chromium/Playwright leftovers in os.tmpdir() owned by this user and untouched for an hour. */
export function sweepTmpLeftovers() {
  const tmp = os.tmpdir();
  const uid = process.getuid?.();
  let removed = 0;
  for (const name of fs.readdirSync(tmp)) {
    if (!TMP_LEFTOVERS.test(name)) continue;
    const full = path.join(tmp, name);
    let stat;
    try {
      stat = fs.lstatSync(full);
    } catch {
      continue;
    }
    if (uid !== undefined && stat.uid !== uid) continue;
    if (Date.now() - stat.mtimeMs < TMP_MIN_AGE_MS) continue;
    fs.rmSync(full, { recursive: true, force: true });
    removed++;
  }
  return removed;
}

/**
 * Creates an empty profile directory that is removed when the process exits.
 * Pass `env` to launchPersistentContext/launch so Chromium's temp files land inside the profile.
 */
export function createBrowserProfile(prefix = 'profile') {
  sweepStaleProfiles();
  fs.mkdirSync(PROFILES_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(PROFILES_ROOT, `${prefix}-${process.pid}-`));
  live.add(dir);
  installHandlers();
  return {
    dir,
    env: dir.length <= MAX_TMPDIR_LENGTH ? { ...process.env, TMPDIR: dir } : { ...process.env },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
      live.delete(dir);
    },
  };
}

// Not import.meta: Playwright's test runner compiles this file to CommonJS.
if (path.basename(process.argv[1] ?? '') === 'browser-profile.mjs' && process.argv.includes('--clean')) {
  const profiles = sweepStaleProfiles();
  const tmp = sweepTmpLeftovers();
  console.log(`Removed ${profiles} stale profile(s) from ${PROFILES_ROOT} and ${tmp} leftover(s) from ${os.tmpdir()}`);
}
