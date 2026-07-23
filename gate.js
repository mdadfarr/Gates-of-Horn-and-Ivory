// gate.js — no unlock control here except "check again now", which triggers
// the SAME real API check background.js runs on its own schedule. There is
// no client-side branch that can flip a requirement to done.

import { getRawState, getConfig, isUnlocked, phaseDescription } from "./common.js";

const params = new URLSearchParams(location.search);
const blockedSite = params.get("d") || "this site";
document.getElementById("siteStamp").textContent = `blocked: ${blockedSite}`;

function fmtTime(ms) {
  if (!ms) return "never";
  return new Date(ms).toLocaleTimeString();
}

function renderRow(label, done, metaText) {
  const row = document.createElement("div");
  row.className = "ledger-row";
  row.innerHTML = `
    <span class="mark ${done ? "done" : "pending"}">${done ? "✅" : "⬜"}</span>
    <span class="label">${label}</span>
    <span class="meta">${metaText || ""}</span>
  `;
  return row;
}

async function render() {
  const [state, config] = await Promise.all([getRawState(), getConfig()]);
  const unlocked = isUnlocked(state, config);

  if (unlocked) {
    // Requirement was met (likely by a background recheck) — send them on.
    location.href = `https://${blockedSite}`;
    return;
  }

  const ledger = document.getElementById("ledger");
  ledger.innerHTML = "";
  ledger.appendChild(
    renderRow(
      `GitHub push — ${config.githubUsername || "(no username set)"}`,
      state.githubDone
    )
  );
  ledger.appendChild(
    renderRow(
      `LeetCode solve — ${config.leetcodeUsername || "(no username set)"}`,
      state.leetcodeDone
    )
  );

  document.getElementById("phaseNote").textContent = phaseDescription(config);
  document.getElementById("lastCheckedHint").textContent = `last checked: ${fmtTime(state.lastCheck)}`;

  const errBox = document.getElementById("errorBox");
  const streak = state.consecutiveErrors || {};
  if ((streak.github || 0) >= 3 || (streak.leetcode || 0) >= 3) {
    errBox.style.display = "block";
    errBox.textContent = `Check is failing repeatedly (${state.lastError?.source}): ${state.lastError?.message}. Investigate in options — don't assume you just haven't done it yet.`;
  } else {
    errBox.style.display = "none";
  }
}

document.getElementById("recheckBtn").addEventListener("click", async (e) => {
  e.target.disabled = true;
  e.target.textContent = "Checking…";
  try {
    await chrome.runtime.sendMessage({ type: "recheckNow" });
  } finally {
    e.target.disabled = false;
    e.target.textContent = "Check again now";
    render();
  }
});

render();
