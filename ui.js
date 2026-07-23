// Shared rendering for gate.html and popup.html so the two views can't drift.

const REQS = [
  { key: "githubDone", name: "GitHub push", who: (c) => c.githubUsername },
  { key: "leetcodeDone", name: "LeetCode solve", who: (c) => c.leetcodeUsername }
];

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
