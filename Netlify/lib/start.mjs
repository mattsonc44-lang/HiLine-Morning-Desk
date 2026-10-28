// Marks a refresh as running and hands it to the background function, with cost limits.
import { getStatus, saveStatus, getUsage, saveUsage } from "./store.mjs";

const RUNNING_STALE_MS = 15 * 60 * 1000; // a run can't outlast the 15-minute background limit
const COOLDOWN_MS = 5 * 60 * 1000;
const envNum = (k, d) => {
  const v = Number(Netlify.env.get(k));
  return Number.isFinite(v) && v > 0 ? v : d;
};

const mtDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(new Date());

export async function startRefresh({ origin, zip, trigger }) {
  const status = await getStatus(zip);
  const now = Date.now();

  if (status.state === "running" && status.startedAt && now - Date.parse(status.startedAt) < RUNNING_STALE_MS) {
    return { code: 409, message: "A refresh is already running. The page will update when it finishes." };
  }

  // Scheduled runs have their own ZIP limit; manual and first-look runs share a daily cap across all ZIPs.
  if (trigger !== "scheduled") {
    if (status.finishedAt && now - Date.parse(status.finishedAt) < COOLDOWN_MS) {
      const mins = Math.ceil((COOLDOWN_MS - (now - Date.parse(status.finishedAt))) / 60000);
      return { code: 429, message: `Just refreshed. Try again in ${mins} min.` };
    }
    const today = mtDate();
    const usage = await getUsage();
    const count = usage.date === today ? usage.count || 0 : 0;
    if (count >= envNum("MAX_REFRESHES_PER_DAY", 30)) {
      return { code: 429, message: "The site hit its refresh limit for today. Data refreshes again tomorrow morning." };
    }
    await saveUsage({ date: today, count: count + 1 });
  }

  const token = crypto.randomUUID();
  await saveStatus(zip, { ...status, state: "running", startedAt: new Date().toISOString(), trigger, token });

  const res = await fetch(`${origin}/.netlify/functions/refresh-background`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-refresh-token": token },
    body: JSON.stringify({ zip }),
  }).catch((e) => ({ ok: false, status: 0, statusText: String(e) }));

  if (!res.ok && res.status !== 202) {
    await saveStatus(zip, { ...status, state: "idle", token: null, lastError: `Couldn't start the refresh (${res.status || res.statusText}).` });
    return { code: 502, message: "Couldn't start the refresh. Try again in a minute." };
  }
  return { code: 202, message: "Refresh started. This takes 2–5 minutes; the page updates on its own." };
}
