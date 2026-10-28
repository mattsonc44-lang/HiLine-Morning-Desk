// Background function (up to 15 minutes). Only runs when called with the token startRefresh just saved.
import { getStatus } from "../lib/store.mjs";
import { isZip } from "../lib/place.mjs";
import { runWithStatus } from "../lib/refresh.mjs";

export default async (req) => {
  const token = req.headers.get("x-refresh-token");
  const { zip } = await req.json().catch(() => ({}));
  if (!token || !isZip(zip)) return;
  const status = await getStatus(zip);
  if (status.state !== "running" || status.token !== token) return;
  await runWithStatus({ zip, trigger: status.trigger || "manual" });
};
