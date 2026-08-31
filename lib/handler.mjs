import {
  MAX_BODY_BYTES,
  RATE_LIMIT_MS,
  checkLikeRate,
  clientIp,
  computeStats,
  createHate,
  findHate,
  incrementHateLikes,
  isLikeRequest,
  likeIdFrom,
  likeLocks,
  likeRateKey,
  mergeSeed,
  normalizeHate,
  prependHate,
  rateKey,
  seedNeedsWrite,
  validatePost,
  visitorCookieHeader,
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

async function visitorAlreadyLiked(store, keys, hateId) {
  for (const key of keys) {
    const ids = await store.getLikedIds(key);
    if (ids.includes(hateId)) return true;
  }
  return false;
}

async function recordVisitorLike(store, keys, hateId) {
  for (const key of keys) {
    await store.addLikedId(key, hateId);
  }
}

function visitorHeaders(headerMap, extra = {}) {
  const locks = likeLocks(headerMap);
  return {
    locks,
    extra: { ...extra, "Set-Cookie": visitorCookieHeader(locks.cookieId) },
  };
}

async function likeHate(store, seed, body, headers, url) {
  const id = likeIdFrom(url, body);
  if (!id) return json(400, { error: "id is required" });

  const { locks, extra } = visitorHeaders(headers);
  const ip = clientIp(headers);
  const key = likeRateKey(ip);
  const now = Date.now();
  const rate = checkLikeRate(await store.getRate(key), now);
  if (rate.limited) {
    return json(
      429,
      { error: "Rate limited: 30 likes per minute per IP" },
      { ...extra, "Retry-After": String(rate.retry) }
    );
  }

  const feed = await ensureFeed(store, seed);
  const existing = findHate(feed, id);
  if (!existing) return json(404, { error: "hate not found" }, extra);

  if (await visitorAlreadyLiked(store, locks.checkKeys, id)) {
    await store.setRate(key, rate.next);
    return json(200, { success: true, alreadyLiked: true, hate: normalizeHate(existing) }, extra);
  }

  const result = incrementHateLikes(feed, id);
  if (result.error) return json(result.status, { error: result.error }, extra);

  await store.setFeed(result.feed);
  await recordVisitorLike(store, locks.recordKeys, id);
  await store.setRate(key, rate.next);
  return json(200, { success: true, alreadyLiked: false, hate: result.hate }, extra);
}

export async function handleHate(request, store, seed = []) {
  const method = (request.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (method === "GET") {
    const feed = await ensureFeed(store, seed);
    const url = new URL(request.url, "http://localhost");
    const { extra } = visitorHeaders(headerMap(request));
    if (url.searchParams.get("stats") === "true") {
      return json(200, { hates: feed, stats: computeStats(feed) }, extra);
    }
    return json(200, feed, extra);
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

    const url = new URL(request.url, "http://localhost");
    if (isLikeRequest(url, body)) {
      return likeHate(store, seed, body, headers, url);
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
    const { extra } = visitorHeaders(headers);
    return json(201, { success: true, hate }, extra);
  }

  return json(405, { error: "Method not allowed" });
}
