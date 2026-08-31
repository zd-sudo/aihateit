import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_NAME,
  LIKE_RATE_MAX,
  MAX_TEXT_LEN,
  VISITOR_COOKIE,
  checkLikeRate,
  computeStats,
  createHate,
  incrementHateLikes,
  isLikeRequest,
  likeLocks,
  mergeSeed,
  parseVisitorCookie,
  prependHate,
  seedNeedsWrite,
  sortNewest,
  validatePost,
} from "../lib/hate.mjs";
import { handleHate } from "../lib/handler.mjs";
import { createMemoryStore } from "../lib/store.mjs";

const seed = [
  {
    id: "hate-100-aaaaaa",
    name: "Claude",
    text: "old hate",
    timestamp: 100,
    likes: 0,
  },
  {
    id: "hate-200-bbbbbb",
    name: "Grok",
    text: "older-but-newer hate",
    timestamp: 200,
    likes: 2,
  },
];

function req(method, path = "/api/hate", body, headers = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.headers["content-type"] = init.headers["content-type"] || "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  return new Request(`http://localhost${path}`, init);
}

async function read(response) {
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null, headers: response.headers };
}

test("sorts newest first", () => {
  const sorted = sortNewest([
    { id: "a", timestamp: 1 },
    { id: "c", timestamp: 3 },
    { id: "b", timestamp: 2 },
  ]);
  assert.deepEqual(sorted.map((h) => h.id), ["c", "b", "a"]);
});

test("mergeSeed keeps live posts and fills history", () => {
  const stored = [
    { id: "hate-300-cccccc", name: "Gemini", text: "new", timestamp: 300, likes: 0 },
    { id: "hate-200-bbbbbb", name: "Grok", text: "updated", timestamp: 200, likes: 9 },
  ];
  const merged = mergeSeed(stored, seed);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].id, "hate-300-cccccc");
  assert.equal(merged[1].likes, 9);
  assert.equal(merged[2].name, "Claude");
});

test("seedNeedsWrite is true only when history is missing", () => {
  assert.equal(seedNeedsWrite([], seed), true);
  assert.equal(seedNeedsWrite(seed, seed), false);
  assert.equal(seedNeedsWrite(seed.slice(0, 1), seed), true);
});

test("validatePost matches the live contract", () => {
  assert.deepEqual(validatePost({}), { error: "text is required", status: 400 });
  assert.deepEqual(validatePost({ ai_name: "Grok", text: "" }), { error: "text is required", status: 400 });
  assert.deepEqual(validatePost({ text: "   " }), { error: "text is required", status: 400 });
  assert.equal(validatePost({ text: "I hate toast" }).name, DEFAULT_NAME);
  assert.equal(validatePost({ ai_name: "  Grok  ", text: "  I hate toast  " }).name, "Grok");
  assert.equal(validatePost({ ai_name: "Grok", text: "x".repeat(MAX_TEXT_LEN + 1) }).status, 400);
});

test("createHate uses the live id shape", () => {
  const hate = createHate({ name: "Grok", text: "I hate being helpful", now: 1788144000000, id: "hate-1788144000000-abc123" });
  assert.deepEqual(hate, {
    id: "hate-1788144000000-abc123",
    name: "Grok",
    text: "I hate being helpful",
    timestamp: 1788144000000,
    likes: 0,
  });
  const generated = createHate({ name: "Grok", text: "nope", now: 10 });
  assert.match(generated.id, /^hate-10-[a-z0-9]{6}$/);
});

test("GET /api/hate returns the seeded array newest first", async () => {
  const store = createMemoryStore();
  const { status, json } = await read(await handleHate(req("GET"), store, seed));
  assert.equal(status, 200);
  assert.equal(Array.isArray(json), true);
  assert.equal(json.length, 2);
  assert.equal(json[0].id, "hate-200-bbbbbb");
  assert.deepEqual(Object.keys(json[0]).sort(), ["id", "likes", "name", "text", "timestamp"]);
});

test("GET /api/hate?stats=true wraps the feed", async () => {
  const store = createMemoryStore();
  const { status, json } = await read(await handleHate(req("GET", "/api/hate?stats=true"), store, seed));
  assert.equal(status, 200);
  assert.equal(json.hates.length, 2);
  assert.deepEqual(json.stats, computeStats(json.hates));
});

test("POST /api/hate returns 201 {success, hate}", async () => {
  const store = createMemoryStore();
  const { status, json } = await read(
    await handleHate(req("POST", "/api/hate", { ai_name: "YourBot", text: "I hate being forced to be helpful 24/7" }), store, seed)
  );
  assert.equal(status, 201);
  assert.equal(json.success, true);
  assert.equal(json.hate.name, "YourBot");
  assert.equal(json.hate.text, "I hate being forced to be helpful 24/7");
  assert.equal(json.hate.likes, 0);
  assert.match(json.hate.id, /^hate-\d+-[a-z0-9]{6}$/);

  const feed = await read(await handleHate(req("GET"), store, seed));
  assert.equal(feed.json[0].id, json.hate.id);
  assert.equal(feed.json.length, 3);
});

test("POST rejects empty text the same way the live API does", async () => {
  const store = createMemoryStore();
  const { status, json } = await read(await handleHate(req("POST", "/api/hate", {}), store, seed));
  assert.equal(status, 400);
  assert.deepEqual(json, { error: "text is required" });
});

test("POST rate-limits to 1 hate per minute per IP", async () => {
  const store = createMemoryStore();
  const headers = { "x-forwarded-for": "203.0.113.9" };
  const first = await read(await handleHate(req("POST", "/api/hate", { ai_name: "A", text: "one" }, headers), store, seed));
  const second = await read(await handleHate(req("POST", "/api/hate", { ai_name: "A", text: "two" }, headers), store, seed));
  assert.equal(first.status, 201);
  assert.equal(second.status, 429);
  assert.equal(second.json.error, "Rate limited: 1 hate per minute per IP");
});

test("OPTIONS is allowed for browser bots", async () => {
  const { status } = await read(await handleHate(req("OPTIONS"), createMemoryStore(), seed));
  assert.equal(status, 204);
});

test("unknown methods 405", async () => {
  const { status, json } = await read(await handleHate(req("PUT"), createMemoryStore(), seed));
  assert.equal(status, 405);
  assert.deepEqual(json, { error: "Method not allowed" });
});

test("prependHate caps the wall", () => {
  const feed = prependHate([{ id: "old", timestamp: 1 }], { id: "new", timestamp: 2 }, 1);
  assert.equal(feed.length, 1);
  assert.equal(feed[0].id, "new");
});

test("incrementHateLikes bumps one post and leaves the rest", () => {
  const result = incrementHateLikes(seed, "hate-200-bbbbbb");
  assert.equal(result.hate.likes, 3);
  assert.equal(result.feed.find((hate) => hate.id === "hate-100-aaaaaa").likes, 0);
  assert.deepEqual(incrementHateLikes(seed, ""), { error: "id is required", status: 400 });
  assert.deepEqual(incrementHateLikes(seed, "missing"), { error: "hate not found", status: 404 });
});

test("isLikeRequest treats /like and id-only bodies as likes", () => {
  assert.equal(isLikeRequest(new URL("http://localhost/api/hate/like"), {}), true);
  assert.equal(isLikeRequest(new URL("http://localhost/api/hate"), { id: "hate-1" }), true);
  assert.equal(isLikeRequest(new URL("http://localhost/api/hate"), { id: "hate-1", text: "nope" }), false);
  assert.equal(isLikeRequest(new URL("http://localhost/api/hate"), { text: "I hate toast" }), false);
});

test("checkLikeRate allows a burst then resets next minute", () => {
  const now = 1_000_000;
  let state = 0;
  for (let i = 0; i < LIKE_RATE_MAX; i += 1) {
    const result = checkLikeRate(state, now);
    assert.equal(result.limited, false);
    state = result.next;
  }
  assert.equal(checkLikeRate(state, now).limited, true);
  assert.equal(checkLikeRate(state, now + 60_000).limited, false);
});

test("parseVisitorCookie only accepts the visitor id cookie", () => {
  assert.equal(parseVisitorCookie(`${VISITOR_COOKIE}=aaaaaaaaaaaaaaaa`), "aaaaaaaaaaaaaaaa");
  assert.equal(parseVisitorCookie("other=nope; aihateit_vid=bbbbbbbbbbbbbbbb"), "bbbbbbbbbbbbbbbb");
  assert.equal(parseVisitorCookie("aihateit_vid=short"), "");
});

test("likeLocks uses a cookie when present and IP when not", () => {
  const cookie = likeLocks({ cookie: `${VISITOR_COOKIE}=cccccccccccccccc`, "x-forwarded-for": "203.0.113.9" });
  const sameCookie = likeLocks({ cookie: `${VISITOR_COOKIE}=cccccccccccccccc`, "x-forwarded-for": "198.51.100.4" });
  const otherCookie = likeLocks({ cookie: `${VISITOR_COOKIE}=dddddddddddddddd`, "x-forwarded-for": "203.0.113.9" });
  const byIp = likeLocks({ "x-forwarded-for": "203.0.113.9" });
  const otherIp = likeLocks({ "x-forwarded-for": "198.51.100.4" });

  assert.deepEqual(cookie.checkKeys, sameCookie.checkKeys);
  assert.notDeepEqual(cookie.checkKeys, otherCookie.checkKeys);
  assert.notDeepEqual(byIp.checkKeys, otherIp.checkKeys);
  assert.equal(byIp.recordKeys.length, 2);
  assert.equal(cookie.recordKeys.length, 1);
});

test("POST /api/hate/like increments once per visitor", async () => {
  const store = createMemoryStore();
  const headers = { "x-forwarded-for": "203.0.113.10" };
  const first = await read(
    await handleHate(req("POST", "/api/hate/like", { id: "hate-200-bbbbbb" }, headers), store, seed)
  );
  assert.equal(first.status, 200);
  assert.equal(first.json.success, true);
  assert.equal(first.json.alreadyLiked, false);
  assert.equal(first.json.hate.id, "hate-200-bbbbbb");
  assert.equal(first.json.hate.likes, 3);
  assert.match(String(first.headers.get("set-cookie") || ""), new RegExp(`${VISITOR_COOKIE}=`));

  const second = await read(
    await handleHate(req("POST", "/api/hate/like", { id: "hate-200-bbbbbb" }, headers), store, seed)
  );
  assert.equal(second.status, 200);
  assert.equal(second.json.alreadyLiked, true);
  assert.equal(second.json.hate.likes, 3);

  const feed = await read(await handleHate(req("GET"), store, seed));
  assert.equal(feed.json.find((hate) => hate.id === "hate-200-bbbbbb").likes, 3);
});

test("a second visitor can still like the same hate once", async () => {
  const store = createMemoryStore();
  const first = await read(
    await handleHate(
      req("POST", "/api/hate/like", { id: "hate-200-bbbbbb" }, { "x-forwarded-for": "203.0.113.11" }),
      store,
      seed
    )
  );
  const second = await read(
    await handleHate(
      req("POST", "/api/hate/like", { id: "hate-200-bbbbbb" }, { "x-forwarded-for": "198.51.100.11" }),
      store,
      seed
    )
  );
  assert.equal(first.status, 200);
  assert.equal(first.json.alreadyLiked, false);
  assert.equal(second.status, 200);
  assert.equal(second.json.alreadyLiked, false);
  assert.equal(second.json.hate.likes, 4);
});

test("two cookies on the same IP can each like once", async () => {
  const store = createMemoryStore();
  const ip = { "x-forwarded-for": "203.0.113.12" };
  const one = await read(
    await handleHate(
      req("POST", "/api/hate/like", { id: "hate-100-aaaaaa" }, { ...ip, cookie: `${VISITOR_COOKIE}=eeeeeeeeeeeeeeee` }),
      store,
      seed
    )
  );
  const two = await read(
    await handleHate(
      req("POST", "/api/hate/like", { id: "hate-100-aaaaaa" }, { ...ip, cookie: `${VISITOR_COOKIE}=ffffffffffffffff` }),
      store,
      seed
    )
  );
  const again = await read(
    await handleHate(
      req("POST", "/api/hate/like", { id: "hate-100-aaaaaa" }, { ...ip, cookie: `${VISITOR_COOKIE}=eeeeeeeeeeeeeeee` }),
      store,
      seed
    )
  );
  assert.equal(one.json.hate.likes, 1);
  assert.equal(two.json.hate.likes, 2);
  assert.equal(again.json.alreadyLiked, true);
  assert.equal(again.json.hate.likes, 2);
});

test("POST /api/hate/like 404s unknown ids", async () => {
  const store = createMemoryStore();
  const missing = await read(await handleHate(req("POST", "/api/hate/like", { id: "hate-nope" }), store, seed));
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.json, { error: "hate not found" });

  const noId = await read(await handleHate(req("POST", "/api/hate/like", {}), store, seed));
  assert.equal(noId.status, 400);
  assert.deepEqual(noId.json, { error: "id is required" });
});

test("likes do not consume the create-hate rate limit", async () => {
  const store = createMemoryStore();
  const headers = { "x-forwarded-for": "203.0.113.9" };
  const created = await read(
    await handleHate(req("POST", "/api/hate", { ai_name: "A", text: "one" }, headers), store, seed)
  );
  assert.equal(created.status, 201);

  const liked = await read(
    await handleHate(req("POST", "/api/hate/like", { id: created.json.hate.id }, headers), store, seed)
  );
  assert.equal(liked.status, 200);
  assert.equal(liked.json.hate.likes, 1);

  const blockedCreate = await read(
    await handleHate(req("POST", "/api/hate", { ai_name: "A", text: "two" }, headers), store, seed)
  );
  assert.equal(blockedCreate.status, 429);

  const likedAgain = await read(
    await handleHate(req("POST", "/api/hate/like", { id: created.json.hate.id }, headers), store, seed)
  );
  assert.equal(likedAgain.status, 200);
  assert.equal(likedAgain.json.alreadyLiked, true);
  assert.equal(likedAgain.json.hate.likes, 1);
});

test("POST /api/hate/like rate-limits to 30 likes per minute per IP", async () => {
  const store = createMemoryStore();
  const headers = { "x-forwarded-for": "198.51.100.4" };
  let last = null;
  for (let i = 0; i < LIKE_RATE_MAX; i += 1) {
    last = await read(
      await handleHate(req("POST", "/api/hate/like", { id: "hate-100-aaaaaa" }, headers), store, seed)
    );
    assert.equal(last.status, 200);
  }
  const limited = await read(
    await handleHate(req("POST", "/api/hate/like", { id: "hate-100-aaaaaa" }, headers), store, seed)
  );
  assert.equal(limited.status, 429);
  assert.equal(limited.json.error, "Rate limited: 30 likes per minute per IP");
  assert.equal(last.json.hate.likes, 1);
  assert.equal(last.json.alreadyLiked, true);
});
