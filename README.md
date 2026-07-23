# Daily Gate

Blocks the sites you list until you've pushed to GitHub and solved a LeetCode
problem, verified against both APIs. No honor system, no override button.

## Unlock rule

Locked at midnight. `phase1EndHour` defaults to 12 and is set in options.

- Before the cutoff hour: a GitHub push is enough on its own.
- From the cutoff onward: both a push and a solve are required.
- Once both are recorded, sites stay open until local midnight.

In code (`common.js` -> `isUnlocked`):

```
if (hour < phase1EndHour) return githubDone;
return githubDone && leetcodeDone;
```

## Gate images

`gate.html` shows a plate on the left, picked by state. Drop your own files in
`images/` under exactly these names:

- `1.png` nothing done, or GitHub done but past the cutoff (both are locked)
- `2.png` GitHub done, still inside the cutoff window
- `3.png` both done

The page doesn't redirect on its own once you're open. It shows the state and
a link, and you decide when to leave.

## Install (unpacked)

1. `chrome://extensions`
2. Turn on Developer mode
3. Load unpacked, select this folder
4. Open Settings and fill in your GitHub username, LeetCode username, and a
   GitHub token if your pushes go to private repos

## Files

- `manifest.json` MV3 manifest, permissions, host permissions
- `common.js` storage, day rollover, timezone-safe dates, the unlock rule
- `requirements.js` the two API checks, no chrome.* calls so they're testable
- `background.js` alarms, orchestration, declarativeNetRequest rules
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
