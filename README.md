# Daily Gate

Blocks the sites you list until you've pushed to GitHub and solved a LeetCode
problem, verified against both APIs. No honor system, no override button —
aside from two 15-minute meal breaks, and a hard hourly time cap that applies
no matter what you've done.

## Unlock rule

Locked at midnight. `phase1EndHour` defaults to 12 and is set in options.

- Before the cutoff hour: a GitHub push is enough on its own.
- From the cutoff onward: both a push and a solve are required.
- Once both are recorded, sites stay open until local midnight — subject to
  the hourly cap below.

In code (`common.js` -> `isUnlocked`):

```
if (hour < phase1EndHour) return githubDone;
return githubDone && leetcodeDone;
```

## The gate always shows up

Visiting a gated site always lands on `gate.html` first, even after both
requirements are done for the day. Once you're done, the page just shows
`3.png`, says "You got it boss", and gives you one big continue button
through to the site. There's nothing left to check at that point, so nothing
else is shown. Before both are done, the page still behaves as a checklist
(see "Gate images" below).

## Hourly time cap

Separate from everything above: gated sites are capped at **10 minutes per
rolling clock hour** (`HOURLY_CAP_MINUTES` in `common.js`), regardless of
whether GitHub/LeetCode are done and regardless of a meal break. This is
usage-based, not requirement-based — it's tracked while a gated site is the
foreground tab, once a minute, and resets at the top of every clock hour.

- The last 5 minutes of that budget (`WARNING_MINUTES`) grey the page out as
  a warning.
- Once the budget hits zero, the current tab is sent straight to
  `gate.html`, which shows a plain "Time's up" screen. This overrides the
  one-tap continue screen too — even on a day where both requirements are
  met, there's no way through until the hour resets.
- Only the tab you're actually looking at counts; a gated site sitting
  unfocused in a background tab doesn't burn the budget.
- Granularity is 1 minute (the finest `chrome.alarms` supports), so the cap
  can run up to ~1 minute over in practice. That's a deliberate tradeoff, not
  a bug.
- A meal break does not count against this cap (breaks are already a
  deliberate exception) and the cap doesn't cut a break short.

## Lunch and dinner breaks

Two 15-minute windows of direct access, independent of the GitHub/LeetCode
requirements (though still subject to the check-again logic — see below).
Each can be started once per local day — one for lunch, one for dinner.
Start one from the popup or from the gate page itself:

- The block rules come down for exactly 15 minutes; gated sites load with no
  detour and no checklist.
- A small countdown timer is pinned to the right edge of the page for as
  long as the break is running, and the page greys out for the last 5
  minutes as a warning that it's about to end.
- When the 15 minutes are up, the block rules go right back to whatever the
  normal requirement check says they should be, **and** any tab still sitting
  on a gated site is redirected straight to `gate.html` — the block rule
  alone only catches new navigations, so without this an already-open tab
  would just keep working past the break's end.
- Once a meal's break is used for the day, its button shows "Used today"
  until the local date rolls over.

## Streak

A running count of consecutive calendar days both requirements were met,
shown on the gate page and in the popup. It's folded in at the local day
rollover (`ensureFresh` in `common.js`): if the day that just ended had both
`githubDone` and `leetcodeDone`, the streak extends (or starts fresh at 1 if
there was a gap); otherwise it resets to 0. Stored separately from the daily
state so day rollovers don't touch it.

**It resets to 0 whenever you Reload the extension** in `chrome://extensions`
(or when Chrome auto-updates it — both fire the same `"update"` install
reason). This is a deliberate deterrent against reloading the extension to
dodge something, but it's not comprehensive: disabling and re-enabling the
extension fires no equivalent event, so that path is not caught. There's no
reliable way to catch that (or a Chrome/Mac restart, which looks identical to
just being asleep) without producing false resets on totally normal offline
time — see the code comment on `onInstalled` in `background.js` for the
reasoning.

## Gate images

`gate.html` shows a plate on the left, picked by state. Drop your own files in
`images/` under exactly these names:

- `1.png` nothing done, or GitHub done but past the cutoff (both are locked)
- `2.png` GitHub done, still inside the cutoff window
- `3.png` both done — this is also the "You got it boss" screen

## Install (unpacked)

1. `chrome://extensions`
2. Turn on Developer mode
3. Load unpacked, select this folder
4. Open Settings and fill in your GitHub username, LeetCode username, and a
   GitHub token if your pushes go to private repos

## Files

- `manifest.json` MV3 manifest, permissions, host permissions
- `common.js` storage, day rollover, timezone-safe dates, the unlock rule, break state, hourly-cap state, streak
- `requirements.js` the two API checks, no chrome.* calls so they're testable
- `background.js` alarms, orchestration, declarativeNetRequest rules, break scheduling, timer injection, hourly-cap enforcement, streak reset on reload
- `ui.js` shared rendering for the gate page and the popup
- `gate.html` / `gate.js` the blocked page
- `options.html` / `options.js` settings
- `popup.html` / `popup.js` toolbar status
- `style.css` one grotesk, hairline rules, red only for faults

## Limits

- Unauthenticated GitHub events only cover public repos and roughly the last
  90 events. Fine, since only today matters. Add a token for private pushes.
- GitHub allows 60 unauthenticated requests an hour. The 15 minute interval
  sits well inside that; don't shorten it much.
- The LeetCode query (`submissionCalendar`) is unofficial and can change
  without notice. If it does, checks fail closed: sites stay blocked and the
  gate page and popup say the check is broken rather than quietly unlocking.
- Adding a site in options can trigger a one time Chrome permission prompt.
- The break timer overlay and the hourly-cap greyscale both use
  `chrome.scripting`, which relies on the extension already holding host
  permission for the gated site (granted through options.js when the site
  was added). Sites added without granting that permission won't show the
  countdown or the greyscale warning, though the underlying block/redirect
  still works.
- None of this is tamper-proof against you specifically: anyone with access
  to `chrome://extensions` can inspect the service worker and edit storage
  directly, uninstall and reinstall, or just edit the files on disk. This
  raises friction; it isn't a lock you don't hold the key to.
