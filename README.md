# Daily Gate

Blocks configured sites every day until you've provably pushed a GitHub
commit and solved a LeetCode problem — no manual override, no honor system.

## Unlock schedule (as configured)

Locked at day start. `phase1EndHour` defaults to 12 (noon), configurable in
options.

- **Before phase1EndHour:** unlocked once GitHub push is done. LeetCode not
  required yet.
- **From phase1EndHour onward (e.g. through 5pm and the rest of the day):**
  locked again — now requires **both** GitHub push and LeetCode solve to
  unlock. If neither is done by then, both are required, same as if only one
  is missing: the gate only opens once both flags are true.
- Once both are true, stays unlocked for the rest of the local day.
- State resets at local midnight.

This collapses to one rule in code (`common.js` → `isUnlocked`):

```
if (hour < phase1EndHour) return githubDone;
else return githubDone && leetcodeDone;
```

## Install (unpacked)

1. `chrome://extensions`
2. Enable Developer mode (top right)
3. "Load unpacked" → select this folder
4. Open the extension's options page and set your GitHub username, LeetCode
   username, and (optionally) a GitHub token for private-repo pushes.

## Files

- `manifest.json` — MV3 manifest, permissions, host permissions
- `common.js` — storage helpers, day-rollover, timezone-safe date conversion, unlock rule
- `requirements.js` — GitHub + LeetCode check functions (isolated, no chrome.* calls — pass a fetch impl to unit test)
- `background.js` — alarms, orchestrates checks, builds/tears down declarativeNetRequest rules
- `gate.html` / `gate.js` — blocked-page checklist + "check again now" (real recheck, not a fake unlock)
- `options.html` / `options.js` — configuration
- `popup.html` / `popup.js` — quick status view
- `style.css` — shared ledger-style look

## Notes / limitations

- GitHub: unauthenticated `events/public` only sees **public** repos and only
  the last ~90 events / ~10 days — fine since only today matters. Add a
  token in options for private-repo pushes to count.
- GitHub rate limit: 60 req/hr unauthenticated. The 15-minute check interval
  is well inside that; don't lower it much further.
- LeetCode: uses an unofficial public GraphQL query (`submissionCalendar`).
  LeetCode can change this schema without notice. If the check starts
  failing repeatedly, Daily Gate **fails closed** (keeps blocking) and
  surfaces a visible error in the popup and gate page rather than silently
  unlocking.
- Adding a new gated site in options may trigger a one-time Chrome
  permission prompt (`optional_host_permissions`).
