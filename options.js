import { getConfig, setConfig } from "./common.js";

const els = {
  githubUsername: document.getElementById("githubUsername"),
  githubToken: document.getElementById("githubToken"),
  leetcodeUsername: document.getElementById("leetcodeUsername"),
  phase1EndHour: document.getElementById("phase1EndHour"),
  gatedSites: document.getElementById("gatedSites"),
  saveBtn: document.getElementById("saveBtn"),
  savedFlag: document.getElementById("savedFlag"),
  statusNote: document.getElementById("statusNote"),
  scheduleExplain: document.getElementById("scheduleExplain")
};

function populateHourSelect() {
  for (let h = 0; h < 24; h++) {
    const opt = document.createElement("option");
    opt.value = String(h);
    opt.textContent = h === 0 ? "12:00 AM" : h < 12 ? `${h}:00 AM` : h === 12 ? "12:00 PM (noon)" : `${h - 12}:00 PM`;
    els.phase1EndHour.appendChild(opt);
  }
}

function updateExplain() {
  const h = Number(els.phase1EndHour.value);
  const label = els.phase1EndHour.selectedOptions[0]?.textContent || `${h}:00`;
  els.scheduleExplain.textContent =
    `Before ${label}: unlocked once GitHub is done (LeetCode not required yet). ` +
    `From ${label} onward: locked again until BOTH GitHub and LeetCode are done.`;
}

async function load() {
  populateHourSelect();
  const config = await getConfig();
  els.githubUsername.value = config.githubUsername;
  els.githubToken.value = config.githubToken;
  els.leetcodeUsername.value = config.leetcodeUsername;
  els.phase1EndHour.value = String(config.phase1EndHour);
  els.gatedSites.value = config.gatedSites.join("\n");
  updateExplain();
  els.statusNote.textContent = "Checks run on install, browser start, and every ~15 minutes. Rate limits: GitHub 60/hr unauthenticated, so don't lower the interval much further.";
}

els.phase1EndHour.addEventListener("change", updateExplain);

function parseSites(raw) {
  return raw
    .split("\n")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => s.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
}

async function requestHostPermissionIfNeeded(sites) {
  const origins = sites.map((s) => `*://*.${s}/*`);
  const already = await chrome.permissions.contains({ origins });
  if (already) return true;
  return chrome.permissions.request({ origins });
}

els.saveBtn.addEventListener("click", async () => {
  const sites = parseSites(els.gatedSites.value);
  if (sites.length === 0) {
    els.statusNote.textContent = "Add at least one gated site.";
    return;
  }

  const granted = await requestHostPermissionIfNeeded(sites);
  if (!granted) {
    els.statusNote.textContent = "Permission for one or more new sites was denied — they will not be blocked until granted.";
  }

  await setConfig({
    githubUsername: els.githubUsername.value.trim(),
    githubToken: els.githubToken.value.trim(),
    leetcodeUsername: els.leetcodeUsername.value.trim(),
    phase1EndHour: Number(els.phase1EndHour.value),
    gatedSites: sites
  });

  await chrome.runtime.sendMessage({ type: "configChanged" });

  els.savedFlag.style.display = "inline";
  setTimeout(() => (els.savedFlag.style.display = "none"), 1500);
});

load();
