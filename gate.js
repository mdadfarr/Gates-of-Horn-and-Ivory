// The blocked page. Normally the only control here is "check again", which
// runs the same API check background.js runs on its schedule — nothing here
// can set a requirement to done by itself.
//
// Three deliberate exceptions to the checklist:
//  - Lunch/dinner breaks: 15 minutes of direct access, once each per day.
//  - Once both requirements are already done for the day, this page still
//    shows up on every visit to a gated site (background.js keeps the
//    redirect rule in place on purpose), but as a one-tap "continue" screen
//    instead of a checklist.
//  - The hourly time cap: at most HOURLY_CAP_MINUTES of gated-site time per
//    clock hour, no matter what's been done that day. This OVERRIDES the
//    one-tap continue screen too — if the hour's budget is spent, there's no
//    continue button at all until it resets, even with both requirements done.
//
// Images live in images/ and are picked by state:
//   1.png  nothing done, or done with GitHub but past the cutoff
//   2.png  GitHub done, still inside the phase-1 window
//   3.png  both done

import {
  getRawState, getConfig, isUnlocked, phaseDescription, hourLabel, breakInfo,
  capInfo, getStreak
} from "./common.js";
import { drawLedger, paintFault, drawBreaks, clockOf, isoDateOf, streakLabel, capLabel } from "./ui.js";

const site = new URLSearchParams(location.search).get("d") || "this site";

const el = {
  siteStamp: document.getElementById("siteStamp"),
  rail: document.getElementById("rail"),
  image: document.getElementById("stateImg"),
  flag: document.getElementById("flag"),
  status: document.getElementById("statusWord"),
  phase: document.getElementById("phaseNote"),
  ledger: document.getElementById("ledger"),
  breaks: document.getElementById("breaks"),
  resolution: document.getElementById("unlockedNote"),
  fault: document.getElementById("errorBox"),
  recheck: document.getElementById("recheckBtn"),
  continue: document.getElementById("continueBtn"),
  checked: document.getElementById("lastCheckedHint"),
  streak: document.getElementById("streakHint"),
  cap: document.getElementById("capHint")
};

el.siteStamp.textContent = site;
el.rail.textContent = `${isoDateOf()} / local`;

function plateFor(state, unlocked) {
  if (state.githubDone && state.leetcodeDone) return "images/3.png";
  if (unlocked) return "images/2.png";
  return "images/1.png";
}

function goToSite() {
  location.href = `https://${site}`;
}

async function continueToSite() {
  el.continue.setAttribute("aria-disabled", "true");
  await chrome.runtime.sendMessage({ type: "continueToSite", site });
  goToSite();
}

async function render() {
  const [state, config, streak] = await Promise.all([getRawState(), getConfig(), getStreak()]);
  const unlocked = isUnlocked(state, config);
  const bothDone = state.githubDone && state.leetcodeDone;
  const cap = capInfo(state);

  el.checked.textContent = `Last checked ${clockOf(state.lastCheck)}`;
  el.streak.textContent = streakLabel(streak);
  el.cap.textContent = capLabel(cap);

  if (cap.capped) {
    // The hourly budget is spent. This wins over everything else — even a
    // fully "done for the day" state doesn't get a continue button right now.
    el.image.src = plateFor(state, unlocked);
    el.flag.dataset.open = "false";
    el.status.textContent = "Time's up";
    el.phase.textContent = "This hour's time budget is used up, regardless of what's done today.";
    el.ledger.hidden = true;
    el.breaks.hidden = true;
    el.resolution.hidden = true;
    el.fault.hidden = true;
    el.continue.hidden = true;
    return;
  }

  if (bothDone) {
    // Both requirements are already met today. Nothing left to track — just
    // a one-tap continue.
    el.image.src = plateFor(state, unlocked);
    el.flag.dataset.open = String(unlocked);
    el.status.textContent = "You got it boss";
    el.phase.textContent = "Both requirements were already met today.";
    el.ledger.hidden = true;
    el.breaks.hidden = true;
    el.resolution.hidden = true;
    el.fault.hidden = true;
    el.continue.classList.add("btn-boss");
    el.continue.textContent = `Continue to ${site}`;
    el.continue.href = `https://${site}`;
    el.continue.hidden = false;
    return;
  }

  el.image.src = plateFor(state, unlocked);
  el.flag.dataset.open = String(unlocked);
  el.ledger.hidden = false;
  el.breaks.hidden = false;
  el.continue.classList.remove("btn-boss");
  el.status.textContent = unlocked ? "Open" : "Closed";
  el.phase.textContent = phaseDescription(config);

  drawLedger(el.ledger, state, config);
  drawBreaks(el.breaks, {
    lunch: breakInfo(state, "lunch"),
    dinner: breakInfo(state, "dinner")
  });
  paintFault(el.fault, state);

  if (unlocked) {
    el.resolution.textContent = `GitHub push recorded. Sites are open until ${hourLabel(config.phase1EndHour)}, then LeetCode is required too.`;
    el.resolution.hidden = false;
    el.continue.textContent = `Continue to ${site}`;
    el.continue.href = `https://${site}`;
    el.continue.hidden = false;
  } else {
    el.resolution.hidden = true;
    el.continue.hidden = true;
  }
}

el.recheck.addEventListener("click", async () => {
  el.recheck.disabled = true;
  el.recheck.textContent = "Checking";
  try {
    await chrome.runtime.sendMessage({ type: "recheckNow" });
  } finally {
    el.recheck.disabled = false;
    el.recheck.textContent = "Check again";
    render();
  }
});

el.continue.addEventListener("click", (e) => {
  e.preventDefault();
  continueToSite();
});

el.breaks.addEventListener("click", async (e) => {
  const btn = e.target.closest(".break-btn");
  if (!btn || btn.disabled) return;
  const meal = btn.dataset.meal;
  btn.disabled = true;
  btn.textContent = "Starting";
  const res = await chrome.runtime.sendMessage({ type: "startBreak", meal });
  if (res?.ok) {
    goToSite();
  } else {
    await render();
  }
});

render();
