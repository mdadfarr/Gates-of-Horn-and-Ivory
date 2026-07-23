import { getRawState, getConfig, isUnlocked, phaseDescription } from "./common.js";
import { drawLedger, paintFault, clockOf, isoDateOf } from "./ui.js";

const el = {
  dateStamp: document.getElementById("dateStamp"),
  flag: document.getElementById("flag"),
  status: document.getElementById("statusWord"),
  phase: document.getElementById("phaseNote"),
  ledger: document.getElementById("ledger"),
  fault: document.getElementById("errorBox"),
  recheck: document.getElementById("recheckBtn"),
  checked: document.getElementById("lastCheckedHint")
};

el.dateStamp.textContent = isoDateOf();

async function render() {
  const [state, config] = await Promise.all([getRawState(), getConfig()]);
  const unlocked = isUnlocked(state, config);

  el.flag.dataset.open = String(unlocked);
  el.status.textContent = unlocked ? "Open" : "Closed";
  el.phase.textContent = phaseDescription(config);
  el.checked.textContent = `Last checked ${clockOf(state.lastCheck)}`;

  drawLedger(el.ledger, state, config);
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

render();
