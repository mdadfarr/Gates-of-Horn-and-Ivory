// MV3 service worker: owns the alarm loop, the requirement checks, and the
// declarativeNetRequest rules. A successful API check is the only thing that
// clears a requirement. There is deliberately no override branch.
//
// The one exception is the lunch/dinner break: it doesn't clear anything, it
// just buys 15 minutes of direct access to the gated sites. See startBreak.
//
// Separately, ON TOP of all of that, gated sites are hard-capped at
// HOURLY_CAP_MINUTES of actual time per rolling clock hour, no matter what's
// been done that day. That cap is enforced by the usage-tick alarm below and
// is independent of isUnlocked/breaks — see tickUsage.

import {
  ensureFresh, setState, getConfig, isUnlocked,
  activeBreak, breakUsedToday, todayStr, MEALS, BREAK_MINUTES,
  hourKeyOf, capInfo, WARNING_MINUTES, matchesGatedSite, resetStreak
} from "./common.js";
import { checkGithubPush, checkLeetcodeSolve } from "./requirements.js";

const ALARM_NAME = "daily-gate-recheck";
const USAGE_ALARM = "daily-gate-usage-tick";
const MAX_ERROR_STREAK_TO_SURFACE = 3;

function ruleIdForSite(index) {
  // Small stable ids so our dynamic rules never collide with anything else.
  return 1000 + index;
}

function ruleIdForBypass(index) {
  // A different range so a bypass rule never collides with a block rule.
  return 5000 + index;
}

async function buildBlockRules(config) {
  return config.gatedSites.map((site, i) => ({
    id: ruleIdForSite(i),
    priority: 1,
    action: {
      type: "redirect",
      redirect: { extensionPath: `/gate.html?d=${encodeURIComponent(site)}` }
    },
    condition: {
      urlFilter: `||${site}^`,
      resourceTypes: ["main_frame"]
    }
  }));
}

/**
 * intercept=true installs the redirect rules, so any visit to a gated site
 * lands on gate.html first — that stays true even once both requirements are
 * done. gate.html is the one that decides what to show once it sees the
 * state (the checklist, the one-tap "you got it boss" continue screen, or
 * the hourly-limit screen).
 * intercept=false is only for the 15 minutes of an active lunch/dinner
 * break, when sites should load with no detour at all.
 */
async function applyRules(intercept, config) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);

  if (intercept) {
    const addRules = await buildBlockRules(config);
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  } else {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
  }
}

/** hostname of a tab's URL, or null if it's not a real navigable page. */
function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Sends a tab straight to gate.html?d=<site>. Used both to fix up tabs left
 * open when a break ends, and to enforce the hourly cap mid-session — in
 * both cases the DNR redirect rule alone isn't enough because it only fires
 * on new navigations, not on tabs that already loaded the real site.
 */
async function forceGateTab(tabId, url) {
  const site = hostnameOf(url);
  if (!site) return;
  const target = chrome.runtime.getURL(`gate.html?d=${encodeURIComponent(site)}`);
  try {
    await chrome.tabs.update(tabId, { url: target });
  } catch {
    // Tab may have closed already; nothing to do.
  }
}

/** Every open tab currently sitting on a gated site, sent to gate.html. */
async function redirectOpenGatedTabs(config) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.url) continue;
    const hostname = hostnameOf(tab.url);
    if (hostname && matchesGatedSite(hostname, config.gatedSites)) {
      await forceGateTab(tab.id, tab.url);
    }
  }
}

/**
 * Runs both checks, records the result and any error streaks, rebuilds the
 * block rules to match, and hands back the fresh state.
 */
export async function runCheck() {
  const config = await getConfig();
  let state = await ensureFresh();

  const [githubResult, leetcodeResult] = await Promise.all([
    state.githubDone ? Promise.resolve({ done: true, error: null }) : checkGithubPush(config.githubUsername, config.githubToken),
    state.leetcodeDone ? Promise.resolve({ done: true, error: null }) : checkLeetcodeSolve(config.leetcodeUsername)
  ]);

  const consecutiveErrors = { ...state.consecutiveErrors };
  let lastError = state.lastError;

  if (githubResult.error) {
    consecutiveErrors.github = (consecutiveErrors.github || 0) + 1;
    lastError = { source: "github", message: githubResult.error, at: Date.now() };
  } else {
    consecutiveErrors.github = 0;
  }

  if (leetcodeResult.error) {
    consecutiveErrors.leetcode = (consecutiveErrors.leetcode || 0) + 1;
    lastError = { source: "leetcode", message: leetcodeResult.error, at: Date.now() };
  } else {
    consecutiveErrors.leetcode = 0;
  }

  state = await setState({
    githubDone: state.githubDone || githubResult.done,
    leetcodeDone: state.leetcodeDone || leetcodeResult.done,
    lastCheck: Date.now(),
    lastError,
    consecutiveErrors
  });

  const unlocked = isUnlocked(state, config);
  const brk = activeBreak(state);
  await applyRules(!brk, config);

  return {
    state,
    config,
    unlocked,
    breakActive: brk,
    failingRepeatedly: {
      github: consecutiveErrors.github >= MAX_ERROR_STREAK_TO_SURFACE,
      leetcode: consecutiveErrors.leetcode >= MAX_ERROR_STREAK_TO_SURFACE
    }
  };
}

/**
 * The redirect rule matches the real site too, not just the first visit —
 * that's what makes the gate show up again on every open. So the Continue
 * button can't just navigate to `https://site`; it would bounce straight
 * back to gate.html. This adds a short-lived, higher-priority "allow" rule
 * for that one site so the one navigation the button triggers actually gets
 * through, then cleans itself up ~65 seconds later via alarm (plenty of time
 * for the page to load; well short of the site showing the gate again on a
 * genuinely new visit).
 */
async function addContinueBypass(site) {
  const config = await getConfig();
  const index = config.gatedSites.indexOf(site);
  if (index === -1) return { ok: false, error: "Unknown site." };

  const rule = {
    id: ruleIdForBypass(index),
    priority: 2,
    action: { type: "allow" },
    condition: { urlFilter: `||${site}^`, resourceTypes: ["main_frame"] }
  };

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [rule.id],
    addRules: [rule]
  });

  chrome.alarms.create(`continue-bypass-${site}`, { when: Date.now() + 65 * 1000 });
  return { ok: true };
}

async function removeContinueBypass(site) {
  const config = await getConfig();
  const index = config.gatedSites.indexOf(site);
  if (index === -1) return;
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [ruleIdForBypass(index)] });
}

async function scheduleAlarm() {
  const config = await getConfig();
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: config.checkIntervalMinutes || 15 });
}

/**
 * The hourly cap only has minute-level granularity (chrome.alarms won't go
 * finer than that), which is plenty for a self-imposed limit like this one.
 */
async function scheduleUsageAlarm() {
  chrome.alarms.create(USAGE_ALARM, { periodInMinutes: 1 });
}

/**
 * Starts a lunch or dinner break: 15 minutes of direct access to the gated
 * sites, once per meal per local day. Rejects if that meal was already used
 * today. Schedules a one-off alarm so the block rules come back the instant
 * the break ends, even if the browser is otherwise idle.
 */
async function startBreak(meal) {
  if (!MEALS.includes(meal)) {
    return { ok: false, error: "Unknown break." };
  }
  const state = await ensureFresh();
  if (breakUsedToday(state, meal)) {
    return { ok: false, error: "Already used today." };
  }

  const endsAt = Date.now() + BREAK_MINUTES * 60 * 1000;
  await setState({ breaks: { ...state.breaks, [meal]: { date: todayStr(), endsAt } } });
  chrome.alarms.create(`break-end-${meal}`, { when: endsAt });

  const result = await runCheck();
  return { ok: true, meal, endsAt, result };
}

/**
 * Draws a small countdown pinned to the right edge of the tab while a break
 * is running, and greys the page out for the last WARNING_MINUTES of it so
 * the end doesn't arrive as a surprise. This runs inside the page via
 * chrome.scripting, so it can't close over anything from this file other
 * than its arguments.
 */
function injectBreakTimer(meal, endsAt, warningMs) {
  const ID = "daily-gate-break-timer";
  const GREY_ID = "daily-gate-break-greyscale";

  if (!document.getElementById(ID)) {
    const box = document.createElement("div");
    box.id = ID;
    box.style.cssText = [
      "position:fixed", "top:50%", "right:16px", "transform:translateY(-50%)",
      "z-index:2147483647", "background:#15161a", "color:#efeeea",
      "font:600 12px/1.3 'Helvetica Neue',Helvetica,Arial,sans-serif",
      "letter-spacing:0.06em", "text-transform:uppercase", "padding:14px 18px",
      "border-radius:3px", "box-shadow:0 6px 20px rgba(0,0,0,0.4)", "text-align:center",
      "min-width:96px", "pointer-events:none"
    ].join(";");

    const label = document.createElement("div");
    label.textContent = meal === "lunch" ? "Lunch break" : "Dinner break";
    label.style.cssText = "font-size:9px;letter-spacing:0.14em;color:#c7c5bd;margin-bottom:6px;";

    const clock = document.createElement("div");
    clock.className = "daily-gate-clock";
    clock.style.cssText = "font-size:22px;font-variant-numeric:tabular-nums;";

    box.append(label, clock);
    document.documentElement.appendChild(box);
  }

  function setGreyscale(on) {
    const existing = document.getElementById(GREY_ID);
    if (on && !existing) {
      const style = document.createElement("style");
      style.id = GREY_ID;
      style.textContent = "html { filter: grayscale(1) !important; transition: filter 600ms linear; }";
      document.documentElement.appendChild(style);
    } else if (!on && existing) {
      existing.remove();
    }
  }

  function tick() {
    const box = document.getElementById(ID);
    if (!box) return;
    const remainMs = endsAt - Date.now();
    if (remainMs <= 0 || !document.documentElement.contains(box)) {
      box.remove();
      setGreyscale(false);
      return;
    }
    const totalSec = Math.ceil(remainMs / 1000);
    const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const s = String(totalSec % 60).padStart(2, "0");
    const clock = box.querySelector(".daily-gate-clock");
    if (clock) clock.textContent = `${m}:${s}`;
    setGreyscale(remainMs <= warningMs);
    setTimeout(tick, 250);
  }
  tick();
}

/**
 * Greys the page out. Used for the last WARNING_MINUTES of the hourly cap
 * (the break-ending warning is handled inside injectBreakTimer instead,
 * since that already runs its own per-tab tick loop).
 */
function injectCapGreyscale() {
  const ID = "daily-gate-cap-greyscale";
  if (document.getElementById(ID)) return;
  const style = document.createElement("style");
  style.id = ID;
  style.textContent = "html { filter: grayscale(1) !important; transition: filter 600ms linear; }";
  document.documentElement.appendChild(style);
}

async function injectIntoTab(tabId, func, args = []) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func, args });
  } catch {
    // Tab wasn't scriptable (chrome://, a store page, etc). Nothing to do.
  }
}

/**
 * Puts the countdown on a tab if it just loaded a gated site and a break is
 * currently running. Reading tab.url here relies on the extension already
 * holding host permission for that site (granted via options.js when the
 * site was added) — the same permission the redirect rule needs anyway.
 */
async function maybeShowBreakTimer(tabId, url) {
  if (!url) return;
  const state = await ensureFresh();
  const brk = activeBreak(state);
  if (!brk) return;

  const hostname = hostnameOf(url);
  if (!hostname) return;

  const config = await getConfig();
  if (!matchesGatedSite(hostname, config.gatedSites)) return;

  await injectIntoTab(tabId, injectBreakTimer, [brk.meal, brk.endsAt, WARNING_MINUTES * 60 * 1000]);
}

/**
 * The active, focused tab if (and only if) it's sitting on a gated site.
 * Only the foreground tab counts toward the hourly cap — a gated site open
 * in a background tab you're not looking at isn't "time spent" on it.
 */
async function getActiveGatedTab(config) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !tab.url) return null;
  const hostname = hostnameOf(tab.url);
  if (!hostname || !matchesGatedSite(hostname, config.gatedSites)) return null;
  return tab;
}

/**
 * Runs once a minute. If the foreground tab is a gated site and no meal
 * break is running (a break is already a deliberate exception, so it isn't
 * charged against the cap), this adds a minute to the current clock hour's
 * usage. Once the cap is hit the tab is sent straight to gate.html — which
 * will show a "time's up" screen no matter what isUnlocked/bothDone say —
 * and in the last few minutes before that, the page is greyed out as a
 * warning.
 */
async function tickUsage() {
  const config = await getConfig();
  const state = await ensureFresh();
  if (activeBreak(state)) return;

  const tab = await getActiveGatedTab(config);
  if (!tab) return;

  const key = hourKeyOf();
  const priorMinutes = state.usage?.hourKey === key ? state.usage.usedMinutes : 0;
  const usedMinutes = priorMinutes + 1;
  const newState = await setState({ usage: { hourKey: key, usedMinutes } });

  const info = capInfo(newState);
  if (info.capped) {
    await forceGateTab(tab.id, tab.url);
  } else if (info.warning) {
    await injectIntoTab(tab.id, injectCapGreyscale);
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  // "update" fires both for an actual version bump and for a manual Reload
  // in chrome://extensions — either way, treat it as a deliberate restart
  // and wipe the streak. (This can't distinguish that from disabling and
  // re-enabling the extension, which fires no equivalent event at all.)
  if (details.reason === "update") {
    await resetStreak();
  }
  await scheduleAlarm();
  await scheduleUsageAlarm();
  await runCheck();
});

chrome.runtime.onStartup.addListener(async () => {
  await scheduleAlarm();
  await scheduleUsageAlarm();
  await runCheck();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    runCheck();
    return;
  }
  if (alarm.name.startsWith("break-end-")) {
    const config = await getConfig();
    await runCheck();
    // The DNR rule alone won't touch a tab that's already loaded on the
    // real site, so any tab left open when the break ends needs to be
    // kicked to gate.html directly.
    await redirectOpenGatedTabs(config);
    return;
  }
  if (alarm.name === USAGE_ALARM) {
    tickUsage();
    return;
  }
  if (alarm.name.startsWith("continue-bypass-")) {
    removeContinueBypass(alarm.name.slice("continue-bypass-".length));
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" && tab.url) {
    maybeShowBreakTimer(tabId, tab.url);
  }
});

// "Check again" from gate.html or popup.html. Same real check the alarm runs,
// just off-schedule. It asks whether the requirement has been met; it can't
// answer yes on its own.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "recheckNow") {
    runCheck().then(sendResponse);
    return true; // keeps the message channel open for the async reply
  }
  if (message?.type === "configChanged") {
    runCheck().then(() => scheduleAlarm()).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "startBreak") {
    startBreak(message.meal).then(sendResponse);
    return true;
  }
  if (message?.type === "continueToSite") {
    addContinueBypass(message.site).then(sendResponse);
    return true;
  }
});
