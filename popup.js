import { getRawState, getConfig, isUnlocked, phaseDescription, breakInfo, capInfo, getStreak } from "./common.js";
import { drawLedger, paintFault, drawBreaks, clockOf, isoDateOf, streakLabel, capLabel } from "./ui.js";

const el = {
  dateStamp: document.getElementById("dateStamp"),
  flag: document.getElementById("flag"),
  status: document.getElementById("statusWord"),
  phase: document.getElementById("phaseNote"),
  ledger: document.getElementById("ledger"),
  breaks: document.getElementById("breaks"),
  fault: document.getElementById("errorBox"),
  recheck: document.getElementById("recheckBtn"),
  checked: document.getElementById("lastCheckedHint"),
  streak: document.getElementById("streakHint"),
  cap: document.getElementById("capHint")
};

el.dateStamp.textContent = isoDateOf();

async function render() {
  const [state, config, streak] = await Promise.all([getRawState(), getConfig(), getStreak()]);
  const unlocked = isUnlocked(state, config);
  const cap = capInfo(state);

  el.flag.dataset.open = String(unlocked && !cap.capped);
  el.status.textContent = cap.capped ? "Time's up" : (unlocked ? "Open" : "Closed");
  el.phase.textContent = cap.capped
    ? "This hour's gated-site time budget is used up, regardless of what's done today."
    : phaseDescription(config);
  el.checked.textContent = `Last checked ${clockOf(state.lastCheck)}`;
  el.streak.textContent = streakLabel(streak);
  el.cap.textContent = capLabel(cap);

  drawLedger(el.ledger, state, config);
  drawBreaks(el.breaks, {
    lunch: breakInfo(state, "lunch"),
    dinner: breakInfo(state, "dinner")
  });
  paintFault(el.fault, state);
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

el.breaks.addEventListener("click", async (e) => {
  const btn = e.target.closest(".break-btn");
  if (!btn || btn.disabled) return;
  const meal = btn.dataset.meal;
  btn.disabled = true;
  btn.textContent = "Starting";
  await chrome.runtime.sendMessage({ type: "startBreak", meal });
  render();
});

render();
