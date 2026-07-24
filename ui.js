// Shared rendering for gate.html and popup.html so the two views can't drift.

import { nextHourBoundaryLabel, HOURLY_CAP_MINUTES } from "./common.js";

const REQS = [
  { key: "githubDone", name: "GitHub push", who: (c) => c.githubUsername },
  { key: "leetcodeDone", name: "LeetCode solve", who: (c) => c.leetcodeUsername }
];

const MEAL_LABEL = { lunch: "Lunch break", dinner: "Dinner break" };

const ERROR_STREAK_TO_SURFACE = 3;

export function clockOf(ms) {
  if (!ms) return "not yet";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function isoDateOf(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function drawLedger(el, state, config) {
  el.textContent = "";
  for (const req of REQS) {
    const met = !!state[req.key];
    const who = req.who(config) || "no username set";

    const li = document.createElement("li");
    li.className = "req";
    li.dataset.met = String(met);

    const mark = document.createElement("span");
    mark.className = "req-mark";

    const name = document.createElement("span");
    name.className = "req-name";
    name.textContent = req.name;

    const byline = document.createElement("span");
    byline.className = "req-who";
    byline.textContent = who;
    name.appendChild(byline);

    const flag = document.createElement("span");
    flag.className = "req-state";
    flag.textContent = met ? "Done" : "Not yet";

    li.append(mark, name, flag);
    el.appendChild(li);
  }
}

/**
 * Renders the lunch/dinner break row. `infoByMeal` is `{ lunch, dinner }`,
 * each an object from common.js's breakInfo(): { status: "available" |
 * "active" | "used", endsAt? }. Buttons carry data-meal so the caller can
 * wire up a single click handler for both.
 */
export function drawBreaks(el, infoByMeal) {
  el.textContent = "";

  const heading = document.createElement("p");
  heading.className = "breaks-label";
  heading.textContent = "15 minute break, once each";
  el.appendChild(heading);

  for (const meal of ["lunch", "dinner"]) {
    const info = infoByMeal[meal] || { status: "available" };

    const row = document.createElement("div");
    row.className = "break-row";

    const name = document.createElement("span");
    name.className = "break-name";
    name.textContent = MEAL_LABEL[meal];

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-hollow break-btn";
    btn.dataset.meal = meal;

    if (info.status === "active") {
      btn.disabled = true;
      btn.textContent = "Active now";
    } else if (info.status === "used") {
      btn.disabled = true;
      btn.textContent = "Used today";
    } else {
      btn.textContent = "Start 15 min";
    }

    row.append(name, btn);
    el.appendChild(row);
  }
}

/** Returns null when nothing is wrong, otherwise a headline + body for the notice. */
export function faultOf(state) {
  const streak = state.consecutiveErrors || {};
  const worst = Math.max(streak.github || 0, streak.leetcode || 0);
  if (worst < ERROR_STREAK_TO_SURFACE) return null;

  const source = state.lastError?.source === "leetcode" ? "LeetCode" : "GitHub";
  return {
    head: "Check failing",
    body: `${source} has failed ${worst} times running: ${state.lastError?.message} ` +
      `Sites stay blocked until a check succeeds, so treat this as a broken check, not unfinished work.`
  };
}

export function paintFault(el, state) {
  const fault = faultOf(state);
  if (!fault) {
    el.hidden = true;
    return;
  }
  el.textContent = "";
  const head = document.createElement("span");
  head.className = "notice-head";
  head.textContent = fault.head;
  el.append(head, document.createTextNode(fault.body));
  el.hidden = false;
}

/** "3 day streak", "1 day streak", or "No streak yet". */
export function streakLabel(streak) {
  const count = streak?.count || 0;
  if (count <= 0) return "No streak yet";
  return `${count} day${count === 1 ? "" : "s"} streak`;
}

/** One line describing the hourly cap: minutes left, or when it resets. */
export function capLabel(cap) {
  if (cap.capped) {
    return `Hourly limit used up. Resets at ${nextHourBoundaryLabel()}.`;
  }
  return `${cap.remainingMinutes} of ${HOURLY_CAP_MINUTES} min left this hour.`;
}
