import { getConfig, setConfig, hourLabel } from "./common.js";

const el = {
  githubUsername: document.getElementById("githubUsername"),
  githubToken: document.getElementById("githubToken"),
  leetcodeUsername: document.getElementById("leetcodeUsername"),
  phase1EndHour: document.getElementById("phase1EndHour"),
  gatedSites: document.getElementById("gatedSites"),
  save: document.getElementById("saveBtn"),
  saved: document.getElementById("savedFlag"),
  status: document.getElementById("statusNote"),
  explain: document.getElementById("scheduleExplain")
};

function fillHours() {
  for (let h = 0; h < 24; h++) {
    const opt = document.createElement("option");
    opt.value = String(h);
    opt.textContent = hourLabel(h);
    el.phase1EndHour.appendChild(opt);
  }
}

function explain() {
  const label = hourLabel(Number(el.phase1EndHour.value));
  el.explain.textContent =
    `Before ${label} a GitHub push is enough on its own. ` +
    `From ${label} onward sites block again until both a push and a LeetCode solve are recorded.`;
}

function parseSites(raw) {
  return raw
    .split("\n")
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean)
    .map((line) => line.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
}

async function askForHosts(sites) {
  const origins = sites.map((s) => `*://*.${s}/*`);
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins });
}

el.phase1EndHour.addEventListener("change", explain);

el.save.addEventListener("click", async () => {
  const sites = parseSites(el.gatedSites.value);
  if (sites.length === 0) {
    el.status.textContent = "Add at least one site before saving.";
    return;
  }

  const granted = await askForHosts(sites);

  await setConfig({
    githubUsername: el.githubUsername.value.trim(),
    githubToken: el.githubToken.value.trim(),
    leetcodeUsername: el.leetcodeUsername.value.trim(),
    phase1EndHour: Number(el.phase1EndHour.value),
    gatedSites: sites
  });

  await chrome.runtime.sendMessage({ type: "configChanged" });

  if (granted) {
    el.saved.hidden = false;
    setTimeout(() => (el.saved.hidden = true), 1600);
  } else {
    el.status.textContent = "Saved, but one or more sites were denied permission and won't be blocked yet.";
  }
});

(async function load() {
  fillHours();
  const config = await getConfig();
  el.githubUsername.value = config.githubUsername;
  el.githubToken.value = config.githubToken;
  el.leetcodeUsername.value = config.leetcodeUsername;
  el.phase1EndHour.value = String(config.phase1EndHour);
  el.gatedSites.value = config.gatedSites.join("\n");
  explain();
  el.status.textContent =
    "Checks run on install, on browser start, and every 15 minutes. GitHub allows 60 unauthenticated requests an hour, so a shorter interval will start failing.";
})();
