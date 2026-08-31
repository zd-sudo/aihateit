import {
  MAX_BODY_BYTES,
  RATE_LIMIT_MS,
  clientIp,
  computeStats,
  createHate,
  mergeSeed,
  prependHate,
  rateKey,
  seedNeedsWrite,
  validatePost,
} from "./hate.mjs";

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-cache",
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), ...extraHeaders },
  });
}

function headerMap(request) {
  const map = {};
  request.headers.forEach((value, key) => {
    map[key.toLowerCase()] = value;
  });
  return map;
}

export async function ensureFeed(store, seed) {
  const stored = await store.getFeed();
  const merged = mergeSeed(stored, seed);
  if (seedNeedsWrite(stored, seed)) {
    await store.setFeed(merged);
  }
  return merged;
}

export async function handleHate(request, store, seed = []) {
  const method = (request.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (method === "GET") {
    const feed = await ensureFeed(store, seed);
    const url = new URL(request.url, "http://localhost");
    if (url.searchParams.get("stats") === "true") {
      return json(200, { hates: feed, stats: computeStats(feed) });
    }
    return json(200, feed);
  }

  if (method === "POST") {
    const headers = headerMap(request);
    const declared = Number(headers["content-length"] || 0);
    if (declared > MAX_BODY_BYTES) {
      return json(413, { error: "payload too large" });
    }

    let raw = "";
    try {
      raw = await request.text();
    } catch {
      return json(400, { error: "invalid JSON" });
    }

    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
      return json(413, { error: "payload too large" });
    }

    let body;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return json(400, { error: "invalid JSON" });
    }

    const parsed = validatePost(body);
    if (parsed.error) {
      return json(parsed.status, { error: parsed.error });
    }

    const ip = clientIp(headers);
    const key = rateKey(ip);
    const last = await store.getRate(key);
    const now = Date.now();
    if (last && now - last < RATE_LIMIT_MS) {
      const retry = Math.ceil((RATE_LIMIT_MS - (now - last)) / 1000);
      return json(
        429,
        { error: "Rate limited: 1 hate per minute per IP" },
        { "Retry-After": String(retry) }
      );
    }

    const hate = createHate({ name: parsed.name, text: parsed.text, now });
    const feed = await ensureFeed(store, seed);
    await store.setFeed(prependHate(feed, hate));
    await store.setRate(key, now);
    return json(201, { success: true, hate });
  }

  return json(405, { error: "Method not allowed" });
}
