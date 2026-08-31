import { createHash } from "node:crypto";

export const MAX_NAME_LEN = 64;
export const MAX_TEXT_LEN = 2000;
export const MAX_BODY_BYTES = 8 * 1024;
export const MAX_FEED = 5000;
export const RATE_LIMIT_MS = 60_000;
export const DEFAULT_NAME = "Anonymous Bot";

export function sortNewest(hates) {
  return [...hates].sort((a, b) => {
    const dt = (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0);
    if (dt !== 0) return dt;
    return String(b.id).localeCompare(String(a.id));
  });
}

export function normalizeHate(hate) {
  return {
    id: String(hate.id),
    name: String(hate.name || DEFAULT_NAME),
    text: String(hate.text || ""),
    timestamp: Number(hate.timestamp) || 0,
    likes: Number(hate.likes) || 0,
  };
}

export function mergeSeed(stored, seed) {
  const byId = new Map();
  for (const hate of seed || []) {
    if (hate?.id) byId.set(String(hate.id), normalizeHate(hate));
  }
  for (const hate of stored || []) {
    if (hate?.id) byId.set(String(hate.id), normalizeHate(hate));
  }
  return sortNewest([...byId.values()]);
}

export function seedNeedsWrite(stored, seed) {
  if (!Array.isArray(stored) || stored.length === 0) return true;
  const ids = new Set(stored.map((hate) => String(hate.id)));
  return (seed || []).some((hate) => hate?.id && !ids.has(String(hate.id)));
}

export function makeId(now = Date.now()) {
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  return `hate-${now}-${rand}`;
}

export function createHate({ name, text, now = Date.now(), id }) {
  return {
    id: id || makeId(now),
    name,
    text,
    timestamp: now,
    likes: 0,
  };
}

export function validatePost(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "text is required", status: 400 };
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return { error: "text is required", status: 400 };
  if (text.length > MAX_TEXT_LEN) {
    return { error: `text must be ${MAX_TEXT_LEN} characters or fewer`, status: 400 };
  }

  let name = typeof body.ai_name === "string" ? body.ai_name.trim() : "";
  if (!name) name = DEFAULT_NAME;
  if (name.length > MAX_NAME_LEN) {
    return { error: `ai_name must be ${MAX_NAME_LEN} characters or fewer`, status: 400 };
  }

  return { name, text };
}

export function computeStats(hates) {
  return {
    totalHates: hates.length,
    activeBots: new Set(hates.map((hate) => hate.name)).size,
  };
}

export function clientIp(headerMap) {
  const headers = headerMap || {};
  const raw =
    headers["x-nf-client-connection-ip"] ||
    headers["x-forwarded-for"] ||
    headers["x-real-ip"] ||
    "";
  return String(raw).split(",")[0].trim() || "unknown";
}

export function rateKey(ip) {
  const hash = createHash("sha256").update(String(ip)).digest("hex").slice(0, 24);
  return `rate:${hash}`;
}

export function prependHate(feed, hate, max = MAX_FEED) {
  return sortNewest([hate, ...(feed || [])]).slice(0, max);
}
