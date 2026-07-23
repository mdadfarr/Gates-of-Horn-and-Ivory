// The two checks, kept away from background.js and free of chrome.* calls so
// they can be tested on their own. Pass a fake fetch in to mock the network.

import { utcIsoToLocalDateStr, unixSecondsToLocalDateStr, todayStr } from "./common.js";

/**
 * Did this user push today, in local time? Reads the public events feed, or
 * the authenticated one when a token is set so private repos count as well.
 * Anything unexpected resolves to { done: false, error } and keeps the block.
 */
export async function checkGithubPush(username, token, fetchImpl = fetch) {
  if (!username) {
    return { done: false, error: "No GitHub username configured." };
  }

  const url = token
    ? `https://api.github.com/users/${encodeURIComponent(username)}/events`
    : `https://api.github.com/users/${encodeURIComponent(username)}/events/public`;

  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetchImpl(url, { headers });
  } catch (e) {
    return { done: false, error: `GitHub request failed: ${e.message}` };
  }

  if (!res.ok) {
    return { done: false, error: `GitHub API returned ${res.status}` };
  }

  let events;
  try {
    events = await res.json();
  } catch (e) {
    return { done: false, error: "GitHub API returned unparseable JSON." };
  }

  if (!Array.isArray(events)) {
    return { done: false, error: "GitHub API response was not an array (unexpected shape)." };
  }

  const today = todayStr();
  const pushedToday = events.some((ev) => {
    if (!ev || ev.type !== "PushEvent" || !ev.created_at) return false;
    try {
      return utcIsoToLocalDateStr(ev.created_at) === today;
    } catch {
      return false;
    }
  });

  return { done: pushedToday, error: null };
}

/**
 * Did this user submit anything today, in local time? Reads the submission
 * calendar off LeetCode's public GraphQL endpoint. Same rule as above: on any
 * error or unfamiliar shape it returns not-done and the block stays up.
 */
export async function checkLeetcodeSolve(username, fetchImpl = fetch) {
  if (!username) {
    return { done: false, error: "No LeetCode username configured." };
  }

  const query = `
    query userProfileCalendar($username: String!, $year: Int) {
      matchedUser(username: $username) {
        userCalendar(year: $year) {
          submissionCalendar
        }
      }
    }
  `;

  const year = new Date().getFullYear();

  let res;
  try {
    res = await fetchImpl("https://leetcode.com/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { username, year },
        operationName: "userProfileCalendar"
      })
    });
  } catch (e) {
    return { done: false, error: `LeetCode request failed: ${e.message}` };
  }

  if (!res.ok) {
    return { done: false, error: `LeetCode API returned ${res.status}` };
  }

  let payload;
  try {
    payload = await res.json();
  } catch (e) {
    return { done: false, error: "LeetCode API returned unparseable JSON." };
  }

  // If LeetCode reshapes this response, stop here rather than guess.
  const calendarRaw = payload?.data?.matchedUser?.userCalendar?.submissionCalendar;
  if (typeof calendarRaw !== "string") {
    return { done: false, error: "LeetCode response shape changed (submissionCalendar missing)." };
  }

  let calendar;
  try {
    calendar = JSON.parse(calendarRaw);
  } catch (e) {
    return { done: false, error: "LeetCode submissionCalendar was not valid JSON." };
  }

  const today = todayStr();
  const solvedToday = Object.entries(calendar).some(([unixSecondsStr, count]) => {
    const unixSeconds = Number(unixSecondsStr);
    if (!Number.isFinite(unixSeconds)) return false;
    const n = Number(count);
    if (!Number.isFinite(n) || n <= 0) return false;
    return unixSecondsToLocalDateStr(unixSeconds) === today;
  });

  return { done: solvedToday, error: null };
}
