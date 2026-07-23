// common.js — shared storage helpers, day-rollover logic, timezone-safe date conversion.
// Imported as an ES module by background.js, and loaded via <script type="module"> in
// gate.js / options.js / popup.js.

export const DEFAULT_CONFIG = {
  githubUsername: "",
  leetcodeUsername: "",
  githubToken: "",
  gatedSites: ["youtube.com", "instagram.com"],
  // Unlock rule (see README section "Unlock schedule"):
  //   local hour < phase1EndHour  -> unlocked once GitHub push is done (LeetCode not required yet)
  //   local hour >= phase1EndHour -> unlocked only once BOTH GitHub push AND LeetCode solve are done
  phase1EndHour: 12,
  checkIntervalMinutes: 15
};

const DEFAULT_STATE = {
  date: null, // local YYYY-MM-DD this state belongs to
  githubDone: false,
  leetcodeDone: false,
  lastCheck: null, // ms epoch
  lastError: null, // { source: "github"|"leetcode", message, at } | null
  consecutiveErrors: { github: 0, leetcode: 0 }
};

/** Local (browser-timezone) YYYY-MM-DD for a given Date (defaults to now). */
export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Convert a UTC ISO timestamp string to a local YYYY-MM-DD string. */
export function utcIsoToLocalDateStr(isoUtc) {
  return todayStr(new Date(isoUtc));
}

/** Convert a unix timestamp (seconds, UTC) to a local YYYY-MM-DD string. */
export function unixSecondsToLocalDateStr(unixSeconds) {
  return todayStr(new Date(unixSeconds * 1000));
}

export async function getConfig() {
  const { dailyGateConfig } = await chrome.storage.local.get("dailyGateConfig");
  return { ...DEFAULT_CONFIG, ...(dailyGateConfig || {}) };
}

export async function setConfig(partial) {
  const current = await getConfig();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ dailyGateConfig: next });
  return next;
}

export async function getRawState() {
  const { dailyGateState } = await chrome.storage.local.get("dailyGateState");
  return { ...DEFAULT_STATE, ...(dailyGateState || {}) };
}

export async function setState(partial) {
  const current = await getRawState();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ dailyGateState: next });
  return next;
}

/**
 * Ensures state matches today's local date. If the stored state is from a
 * previous day (or missing), it is reset to a fresh, unmet state for today.
 * Always call this before reading/writing today's requirement flags.
 */
export async function ensureFresh() {
  const state = await getRawState();
  const today = todayStr();
  if (state.date !== today) {
    const fresh = {
      ...DEFAULT_STATE,
      date: today
    };
    await chrome.storage.local.set({ dailyGateState: fresh });
    return fresh;
  }
  return state;
}

/**
 * Unlock rule. See DEFAULT_CONFIG.phase1EndHour comment above.
 */
export function isUnlocked(state, config, now = new Date()) {
  const beforePhase1End = now.getHours() < config.phase1EndHour;
  if (beforePhase1End) {
    return !!state.githubDone;
  }
  return !!(state.githubDone && state.leetcodeDone);
}

/** Human-readable description of the current phase, for UI. */
export function phaseDescription(config, now = new Date()) {
  if (now.getHours() < config.phase1EndHour) {
    const h = config.phase1EndHour;
    const label = h === 12 ? "noon" : `${h}:00`;
    return `Before ${label}: unlocks once GitHub push is done.`;
  }
  return `After phase 1: unlocks only once BOTH GitHub push AND LeetCode solve are done.`;
}
