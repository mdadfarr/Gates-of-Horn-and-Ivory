// Storage helpers, the day rollover, and the one function that decides whether
// the gate is open. Imported by background.js and by the three page scripts.

export const DEFAULT_CONFIG = {
  githubUsername: "",
  leetcodeUsername: "",
  githubToken: "",
  gatedSites: ["youtube.com", "instagram.com"],
  phase1EndHour: 12,
  checkIntervalMinutes: 15
};

const DEFAULT_STATE = {
  date: null,          // local YYYY-MM-DD this state belongs to
  githubDone: false,
  leetcodeDone: false,
  lastCheck: null,     // ms epoch
  lastError: null,     // { source, message, at } or null
  consecutiveErrors: { github: 0, leetcode: 0 }
};

/** Local YYYY-MM-DD. Everything in here is browser-timezone, never UTC. */
export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function utcIsoToLocalDateStr(isoUtc) {
  return todayStr(new Date(isoUtc));
}

export function unixSecondsToLocalDateStr(unixSeconds) {
  return todayStr(new Date(unixSeconds * 1000));
}

/** 0 -> "12:00 AM", 13 -> "1:00 PM". Used by options and by the gate copy. */
export function hourLabel(h) {
  if (h === 0) return "12:00 AM";
  if (h === 12) return "12:00 PM";
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`;
}

export async function getConfig() {
  const { dailyGateConfig } = await chrome.storage.local.get("dailyGateConfig");
  return { ...DEFAULT_CONFIG, ...(dailyGateConfig || {}) };
}

export async function setConfig(partial) {
  const next = { ...(await getConfig()), ...partial };
  await chrome.storage.local.set({ dailyGateConfig: next });
  return next;
}

export async function getRawState() {
  const { dailyGateState } = await chrome.storage.local.get("dailyGateState");
  return { ...DEFAULT_STATE, ...(dailyGateState || {}) };
}

export async function setState(partial) {
  const next = { ...(await getRawState()), ...partial };
  await chrome.storage.local.set({ dailyGateState: next });
  return next;
}

/**
 * Wipes yesterday's flags once the local date has moved on. Call this before
 * reading or writing today's requirement flags.
 */
export async function ensureFresh() {
  const state = await getRawState();
  const today = todayStr();
  if (state.date === today) return state;

  const fresh = { ...DEFAULT_STATE, date: today };
  await chrome.storage.local.set({ dailyGateState: fresh });
  return fresh;
}

/**
 * Before the cutoff hour a GitHub push is enough. After it, both requirements
 * are needed. That's the whole rule.
 */
export function isUnlocked(state, config, now = new Date()) {
  if (now.getHours() < config.phase1EndHour) return !!state.githubDone;
  return !!(state.githubDone && state.leetcodeDone);
}

export function phaseDescription(config, now = new Date()) {
  const label = hourLabel(config.phase1EndHour);
  if (now.getHours() < config.phase1EndHour) {
    return `A GitHub push is enough until ${label}. After that a LeetCode solve is required too.`;
  }
  return `Past ${label}, so both a GitHub push and a LeetCode solve are required today.`;
}
