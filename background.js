// background.js — MV3 service worker. Owns the alarm loop, requirement checks,
// and declarativeNetRequest rule management. No code path here can unlock the
// gate except a successful API check — there is no manual-override branch.

import { ensureFresh, setState, getConfig, isUnlocked } from "./common.js";
import { checkGithubPush, checkLeetcodeSolve } from "./requirements.js";

const ALARM_NAME = "daily-gate-recheck";
const MAX_ERROR_STREAK_TO_SURFACE = 3;

function ruleIdForSite(index) {
  // Stable, small, non-conflicting ids for our own dynamic rules.
  return 1000 + index;
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

async function applyRules(locked, config) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);

  if (locked) {
    const addRules = await buildBlockRules(config);
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  } else {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
  }
}

/**
 * Runs both requirement checks, updates stored state/error streaks, rebuilds
 * DNR rules to match, and returns the fresh state + unlocked flag.
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
  await applyRules(!unlocked, config);

  return {
    state,
    config,
    unlocked,
    failingRepeatedly: {
      github: consecutiveErrors.github >= MAX_ERROR_STREAK_TO_SURFACE,
      leetcode: consecutiveErrors.leetcode >= MAX_ERROR_STREAK_TO_SURFACE
    }
  };
}

async function scheduleAlarm() {
  const config = await getConfig();
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: config.checkIntervalMinutes || 15 });
}

chrome.runtime.onInstalled.addListener(async () => {
  await scheduleAlarm();
  await runCheck();
});

chrome.runtime.onStartup.addListener(async () => {
  await scheduleAlarm();
  await runCheck();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runCheck();
  }
});

// Manual "check again now" from gate.html / popup.html — this triggers the
// SAME real API check, just outside the alarm schedule. It cannot unlock
// anything by itself; it only asks "has the real requirement been met yet?"
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "recheckNow") {
    runCheck().then(sendResponse);
    return true; // keep the message channel open for the async response
  }
  if (message?.type === "configChanged") {
    runCheck().then(() => scheduleAlarm()).then(() => sendResponse({ ok: true }));
    return true;
  }
});
