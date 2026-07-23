import { getRawState, getConfig, isUnlocked, phaseDescription } from "./common.js";

function fmtTime(ms) {
  if (!ms) return "never";
  return new Date(ms).toLocaleTimeString();
}

function renderRow(label, done) {
  const row = document.createElement("div");
  row.className = "ledger-row";
  row.innerHTML = `
    <span class="mark ${done ? "done" : "pending"}">${done ? "✅" : "⬜"}</span>
    <span class="label">${label}</span>
  `;
  return row;
}

async function render() {
  const [state, config] = await Promise.all([getRawState(), getConfig()]);
  const unlocked = isUnlocked(state, config);

  document.getElementById("statusStamp").textContent = unlocked ? "UNLOCKED" : "LOCKED";

  const ledger = document.getElementById("ledger");
  ledger.innerHTML = "";
  ledger.appendChild(renderRow(`GitHub push — ${config.githubUsername || "(unset)"}`, state.githubDone));
  ledger.appendChild(renderRow(`LeetCode solve — ${config.leetcodeUsername || "(unset)"}`, state.leetcodeDone));

  document.getElementById("phaseNote").textContent =
    `${phaseDescription(config)} Last checked: ${fmtTime(state.lastCheck)}.`;

  const errBox = document.getElementById("errorBox");
  const streak = state.consecutiveErrors || {};
  if ((streak.github || 0) >= 3 || (streak.leetcode || 0) >= 3) {
    errBox.style.display = "block";
    errBox.textContent = `Check failing repeatedly (${state.lastError?.source}): ${state.lastError?.message}`;
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
