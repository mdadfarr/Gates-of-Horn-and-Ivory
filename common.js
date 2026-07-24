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

export const MEALS = ["lunch", "dinner"];
export const BREAK_MINUTES = 15;

// Independent of whether GitHub/LeetCode are done: at most this many minutes
// of gated-site time per rolling clock hour, full stop. WARNING_MINUTES is
// the greyscale window before that budget runs out (also reused for the
// last stretch of a meal break).
export const HOURLY_CAP_MINUTES = 10;
export const WARNING_MINUTES = 5;

const DEFAULT_STATE = {
  date: null,          // local YYYY-MM-DD this state belongs to
  githubDone: false,
  leetcodeDone: false,
  lastCheck: null,     // ms epoch
  lastError: null,     // { source, message, at } or null
  consecutiveErrors: { github: 0, leetcode: 0 },
  breaks: { lunch: null, dinner: null }, // each: { date, endsAt } once started, per local day
  usage: { hourKey: null, usedMinutes: 0 } // this clock hour's gated-site usage
};

const DEFAULT_STREAK = { count: 0, lastCompletedDate: null };

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

/** Local YYYY-MM-DDTHH, the bucket the hourly cap resets on. */
export function hourKeyOf(d = new Date()) {
  const h = String(d.getHours()).padStart(2, "0");
  return `${todayStr(d)}T${h}`;
}

/** Label for the top of the next clock hour, e.g. "3:00 PM". */
export function nextHourBoundaryLabel(now = new Date()) {
  const next = new Date(now.getTime());
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return hourLabel(next.getHours());
}

/**
 * Reads however many minutes have been used in the CURRENT clock hour (a
 * stale bucket from a previous hour reads as zero) and how many remain
 * before the hard cap kicks in.
 */
export function capInfo(state, now = new Date()) {
  const hourKey = hourKeyOf(now);
  const usedMinutes = state.usage?.hourKey === hourKey ? state.usage.usedMinutes : 0;
  const remainingMinutes = Math.max(0, HOURLY_CAP_MINUTES - usedMinutes);
  return {
    hourKey,
    usedMinutes,
    remainingMinutes,
    capped: remainingMinutes <= 0,
    warning: remainingMinutes > 0 && remainingMinutes <= WARNING_MINUTES
  };
}

/** True if `hostname` is, or is a subdomain of, one of the configured gated sites. */
export function matchesGatedSite(hostname, gatedSites) {
  return gatedSites.some((site) => hostname === site || hostname.endsWith(`.${site}`));
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
  return {
    ...DEFAULT_STATE,
    ...(dailyGateState || {}),
    breaks: { ...DEFAULT_STATE.breaks, ...(dailyGateState?.breaks || {}) },
    usage: { ...DEFAULT_STATE.usage, ...(dailyGateState?.usage || {}) }
  };
}

export async function setState(partial) {
  const next = { ...(await getRawState()), ...partial };
  await chrome.storage.local.set({ dailyGateState: next });
  return next;
}

export async function getStreak() {
  const { dailyGateStreak } = await chrome.storage.local.get("dailyGateStreak");
  return { ...DEFAULT_STREAK, ...(dailyGateStreak || {}) };
}

export async function setStreak(partial) {
  const next = { ...(await getStreak()), ...partial };
  await chrome.storage.local.set({ dailyGateStreak: next });
  return next;
}

/** Wiped on purpose (e.g. an explicit extension reload) — see background.js. */
export async function resetStreak() {
  const fresh = { ...DEFAULT_STREAK };
  await chrome.storage.local.set({ dailyGateStreak: fresh });
  return fresh;
}

function previousDayStr(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return todayStr(dt);
}

/**
 * Wipes yesterday's flags once the local date has moved on. Call this before
 * reading or writing today's requirement flags.
 *
 * Before wiping, folds whatever day just ended into the streak: if that day
 * had both requirements done, the streak extends (or starts at 1 if the
 * prior completed day wasn't literally yesterday); otherwise it resets to 0.
 */
export async function ensureFresh() {
  const state = await getRawState();
  const today = todayStr();
  if (state.date === today) return state;

  if (state.date) {
    const completed = !!(state.githubDone && state.leetcodeDone);
    const streak = await getStreak();
    if (completed) {
      const consecutive = streak.lastCompletedDate === previousDayStr(state.date);
      await setStreak({
        count: consecutive ? streak.count + 1 : 1,
        lastCompletedDate: state.date
      });
    } else {
      await setStreak({ count: 0 });
    }
  }

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

/**
 * Lunch and dinner each buy 15 minutes of direct access to the gated sites,
 * no requirement needed. Each can only be started once per local day. This
 * is a separate mechanism from isUnlocked — it doesn't clear a requirement,
 * it just opens a timed window. Returns the meal + endsAt of whichever break
 * is currently running, or null if neither is active right now.
 */
export function activeBreak(state, now = new Date()) {
  const today = todayStr(now);
  const nowMs = now.getTime();
  for (const meal of MEALS) {
    const b = state.breaks?.[meal];
    if (b && b.date === today && nowMs < b.endsAt) {
      return { meal, endsAt: b.endsAt };
    }
  }
  return null;
}

export function breakUsedToday(state, meal, now = new Date()) {
  const b = state.breaks?.[meal];
  return !!(b && b.date === todayStr(now));
}

/** status is "active" | "used" | "available", plus endsAt when active. */
export function breakInfo(state, meal, now = new Date()) {
  const active = activeBreak(state, now);
  if (active && active.meal === meal) {
    return { status: "active", endsAt: active.endsAt };
  }
  if (breakUsedToday(state, meal, now)) {
    return { status: "used" };
  }
  return { status: "available" };
}
