// The blocked page. The only control here is "check again", which runs the same
// API check background.js runs on its schedule. Nothing on this page can set a
// requirement to done.
//
// Images live in images/ and are picked by state:
//   1.png  nothing done, or done with GitHub but past the cutoff
//   2.png  GitHub done, still inside the phase-1 window
//   3.png  both done

import { getRawState, getConfig, isUnlocked, phaseDescription, hourLabel } from "./common.js";
import { drawLedger, paintFault, clockOf, isoDateOf } from "./ui.js";

const site = new URLSearchParams(location.search).get("d") || "this site";

const el = {
  siteStamp: document.getElementById("siteStamp"),
  rail: document.getElementById("rail"),
  image: document.getElementById("stateImg"),
  flag: document.getElementById("flag"),
  status: document.getElementById("statusWord"),
  phase: document.getElementById("phaseNote"),
  ledger: document.getElementById("ledger"),
  resolution: document.getElementById("unlockedNote"),
  fault: document.getElementById("errorBox"),
  recheck: document.getElementById("recheckBtn"),
  continue: document.getElementById("continueBtn"),
  checked: document.getElementById("lastCheckedHint")
};

el.siteStamp.textContent = site;
el.rail.textContent = `${isoDateOf()} / local`;

function plateFor(state, unlocked) {
  if (state.githubDone && state.leetcodeDone) return "images/3.png";
  if (unlocked) return "images/2.png";
  return "images/1.png";
}

async function render() {
  const [state, config] = await Promise.all([getRawState(), getConfig()]);
  const unlocked = isUnlocked(state, config);
  const bothDone = state.githubDone && state.leetcodeDone;

  el.image.src = plateFor(state, unlocked);
  el.flag.dataset.open = String(unlocked);
  el.status.textContent = unlocked ? "Open" : "Closed";
  el.phase.textContent = phaseDescription(config);

  drawLedger(el.ledger, state, config);
  paintFault(el.fault, state);

  if (unlocked) {
    el.resolution.textContent = bothDone
      ? "Both requirements met. Sites stay open for the rest of the day."
      : `GitHub push recorded. Sites are open until ${hourLabel(config.phase1EndHour)}, then LeetCode is required too.`;
    el.resolution.hidden = false;
    el.continue.textContent = `Continue to ${site}`;
    el.continue.href = `https://${site}`;
    el.continue.hidden = false;
  } else {
    el.resolution.hidden = true;
    el.continue.hidden = true;
  }

  el.checked.textContent = `Last checked ${clockOf(state.lastCheck)}`;
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

render();
