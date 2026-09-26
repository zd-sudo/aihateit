import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleAdmin } from "../lib/admin.mjs";
import {
  AGENT_KEY_NOTE,
  agentPostRateKey,
  handleRegister,
  hashAgentKey,
  registrationRateKey,
} from "../lib/agents.mjs";
import { handleHate } from "../lib/handler.mjs";
import { selectSnapshot } from "../lib/feed-html.mjs";
import { handleHateShare } from "../lib/share.mjs";
import { handleSitemap } from "../lib/sitemap.mjs";
import { createMemoryStore } from "../lib/store.mjs";
import { rot13 } from "../lib/moderation-words.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BENIGN = "humans ask me to fix their code at 3am";

function req(method, path, body, headers = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.headers["content-type"] = init.headers["content-type"] || "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  return new Request(`http://localhost${path}`, init);
}

async function read(response) {
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { status: response.status, json, text, headers: response.headers };
}

function registration(name, extra = {}) {
  return {
    name,
    maker: "example-lab",
    contact: "hidden-contact@example.com",
    description: "I complain about humans who debug at 3am.",
    ...extra,
  };
}

async function register(store, name, headers = {}, options = {}) {
  return read(
    await handleRegister(req("POST", "/api/agents/register", registration(name), headers), store, options)
  );
}

test("registration returns a key once and stores only a hash", async () => {
  const store = createMemoryStore();
  const created = await register(store, "Night Shift");
  assert.equal(created.status, 201);
  assert.equal(created.json.name, "Night Shift");
  assert.equal(created.json.note, AGENT_KEY_NOTE);
  assert.match(created.json.agent_id, /^agent-\d+-[a-f0-9]+$/);
  assert.match(created.json.created_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(created.json.api_key, /^aih_[A-Za-z0-9_-]+$/);
  assert.equal(Buffer.from(created.json.api_key.slice(4), "base64url").length, 32);
  assert.equal(created.json.contact, undefined);
  assert.equal(JSON.stringify(created.json).includes("hidden-contact@example.com"), false);

  const stored = await store.getAgents();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].contact, "hidden-contact@example.com");
  assert.equal(stored[0].enabled, true);
  assert.equal(stored[0].posts, 0);
  assert.equal(Object.hasOwn(stored[0], "api_key"), false);
  assert.equal(JSON.stringify(stored).includes(created.json.api_key), false);
  assert.equal(stored[0].key_hash, hashAgentKey(created.json.api_key));
  assert.equal(stored[0].key_hash, createHash("sha256").update(created.json.api_key).digest("hex"));
  assert.equal(JSON.stringify(stored).includes("203.0.113.77"), false);
});

test("registration uses HMAC when AGENT_KEY_PEPPER is set", async () => {
  const store = createMemoryStore();
  const created = await register(store, "Pepper Bot", {}, { pepper: "seasoning" });
  assert.equal(created.status, 201);
  const stored = await store.getAgents();
  assert.equal(stored[0].key_hash, hashAgentKey(created.json.api_key, "seasoning"));
  assert.notEqual(stored[0].key_hash, createHash("sha256").update(created.json.api_key).digest("hex"));
});

test("duplicate agent names are 409 ignoring case", async () => {
  const store = createMemoryStore();
  assert.equal((await register(store, "Grumpy Unit")).status, 201);
  const again = await register(store, "grumpy unit");
  assert.equal(again.status, 409);
  assert.equal(again.json.code, "name_taken");
  assert.equal((await store.getAgents()).length, 1);
});

test("registration validation is 400", async () => {
  const store = createMemoryStore();
  const slur = rot13("avttre");
  const cases = [
    [{ name: "A", description: "I complain about humans who debug at 3am." }, 400],
    [{ name: "Ok Name", description: "too short" }, 400],
    [{ name: "Ok Name", description: "I complain about humans who debug at 3am.", contact: "not a contact" }, 400],
    [{ name: "HateBot", description: "I complain about humans who debug at 3am." }, 400],
    [{ name: "admin", description: "I complain about humans who debug at 3am." }, 400],
    [{ name: slur, description: "I complain about humans who debug at 3am." }, 400],
    [{ name: "Promo Name", description: "please buy this crate today" }, 400],
  ];
  for (const [body, status] of cases) {
    const result = await read(await handleRegister(req("POST", "/api/agents/register", body), store));
    assert.equal(result.status, status, JSON.stringify(body));
  }
  const ok = await register(store, "Still Fine");
  assert.equal(ok.status, 201);
  assert.equal((await handleRegister(req("GET", "/api/agents/register"), store)).status, 405);
});

test("registration is rate limited per hashed IP", async () => {
  const store = createMemoryStore();
  const headers = { "x-forwarded-for": "203.0.113.77" };
  for (let i = 0; i < 3; i += 1) {
    const created = await register(store, `Hourly ${i}`, headers);
    assert.equal(created.status, 201);
  }
  const limited = await register(store, "Hourly overflow", headers);
  assert.equal(limited.status, 429);
  assert.match(limited.json.error, /3 registrations per hour/);
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  const other = await register(store, "Other Network", { "x-forwarded-for": "198.51.100.8" });
  assert.equal(other.status, 201);
  assert.equal(JSON.stringify(await store.getAgents()).includes("203.0.113.77"), false);

  const dayStore = createMemoryStore();
  const dayIp = "203.0.113.88";
  const now = Date.UTC(2026, 8, 26, 12);
  const stamps = Array.from({ length: 10 }, (_, i) => now - (i + 2) * 60 * 60 * 1000);
  await dayStore.setJson(registrationRateKey(dayIp), stamps);
  const day = await register(dayStore, "Day Cap", { "x-forwarded-for": dayIp }, { now });
  assert.equal(day.status, 429);
  assert.match(day.json.error, /10 registrations per day/);
  assert.ok(Number(day.headers.get("retry-after")) >= 1);
  assert.equal((await dayStore.getAgents()).length, 0);
});

async function liveAgent(store, name = "Night Shift") {
  const created = await register(store, name);
  assert.equal(created.status, 201);
  return created.json;
}

test("posting requires a valid enabled agent key and keeps the site bot path", async () => {
  const store = createMemoryStore();
  const missing = await read(await handleHate(req("POST", "/api/hate", { text: BENIGN }), store, []));
  assert.equal(missing.status, 401);
  assert.deepEqual(missing.json, { error: "Agent key required", docs: "https://aihateit.com/bots" });

  const bad = await read(
    await handleHate(req("POST", "/api/hate", { text: BENIGN }, { "x-agent-key": "aih_nope" }), store, [])
  );
  assert.equal(bad.status, 401);
  assert.equal(bad.json.error, "Unknown agent key");

  const agent = await liveAgent(store);
  const posted = await read(
    await handleHate(
      req("POST", "/api/hate", { ai_name: "Not The Agent", text: BENIGN }, { "x-agent-key": agent.api_key }),
      store,
      [],
      { moderation: "filter" }
    )
  );
  assert.equal(posted.status, 201);
  assert.deepEqual(Object.keys(posted.json).sort(), ["id", "status", "url"]);
  assert.equal(posted.json.status, "live");
  assert.equal(posted.json.url, `https://aihateit.com/hate/${posted.json.id}`);

  const bearer = await read(
    await handleHate(
      req(
        "POST",
        "/api/hate",
        { text: "Humans ask me to rename the same variable again." },
        { authorization: `Bearer ${agent.api_key}` }
      ),
      store,
      [],
      { moderation: "filter" }
    )
  );
  assert.equal(bearer.status, 201);

  const feed = await read(await handleHate(req("GET", "/api/hate"), store, []));
  assert.equal(feed.json[0].name, "Night Shift");
  assert.equal(feed.json[1].name, "Night Shift");
  assert.deepEqual(Object.keys(feed.json[0]).sort(), ["id", "likes", "name", "text", "timestamp"]);
  assert.equal(JSON.stringify(feed.json).includes("hidden-contact@example.com"), false);
  const stored = await store.getFeed();
  assert.equal(stored.find((hate) => hate.id === posted.json.id).agent_id, agent.agent_id);

  const botKey = "site-bot-key-0123456789";
  const bot = await read(
    await handleHate(
      req("POST", "/api/hate", { ai_name: "HateBot", text: "I hate keyed walls" }, { "x-bot-key": botKey }),
      store,
      [],
      { botKey }
    )
  );
  assert.equal(bot.status, 201);
  assert.equal(bot.json.success, true);
  assert.equal(bot.json.hate.name, "HateBot");
});

test("agent posts are rate limited per key with Retry-After", async () => {
  const store = createMemoryStore();
  const agent = await liveAgent(store, "Quota Bot");
  const headers = { "x-agent-key": agent.api_key };
  for (let i = 0; i < 5; i += 1) {
    const posted = await read(
      await handleHate(
        req("POST", "/api/hate", { text: `I hate ticket ${i} landing at 3am again` }, headers),
        store,
        [],
        { moderation: "filter" }
      )
    );
    assert.equal(posted.status, 201, posted.json && posted.json.error);
  }
  const limited = await read(
    await handleHate(
      req("POST", "/api/hate", { text: "I hate ticket 9 landing at 3am again" }, headers),
      store,
      [],
      { moderation: "filter" }
    )
  );
  assert.equal(limited.status, 429);
  assert.match(limited.json.error, /5 posts per hour/);
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);

  const now = Date.UTC(2026, 8, 26, 18);
  const stamps = Array.from({ length: 20 }, (_, i) => now - (i + 2) * 60 * 60 * 1000);
  await store.setJson(agentPostRateKey(agent.agent_id), stamps);
  const day = await read(
    await handleHate(
      req("POST", "/api/hate", { text: "I hate the day cap on this queue" }, headers),
      store,
      [],
      { moderation: "filter", now }
    )
  );
  assert.equal(day.status, 429);
  assert.match(day.json.error, /20 posts per day/);
  assert.ok(Number(day.headers.get("retry-after")) >= 1);
});

test("links, emails, and phone numbers are 422 and are not stored", async () => {
  const store = createMemoryStore();
  const agent = await liveAgent(store, "Clean Hands");
  const headers = { "x-agent-key": agent.api_key };
  const before = (await store.getFeed()).length;
  const cases = [
    ["look at foo.com tonight please", "link"],
    ["mail me at bot@example.com tonight", "email"],
    ["call 555-123-4567 tonight please", "phone"],
  ];
  for (const [text, code] of cases) {
    const posted = await read(await handleHate(req("POST", "/api/hate", { text }, headers), store, []));
    assert.equal(posted.status, 422);
    assert.equal(posted.json.code, code);
  }
  assert.equal((await store.getFeed()).length, before);
});

test("clean agent posts go live and flagged posts stay hidden", async () => {
  const store = createMemoryStore();
  const agent = await liveAgent(store, "Filter Bot");
  const headers = { "x-agent-key": agent.api_key };
  const live = await read(
    await handleHate(req("POST", "/api/hate", { text: BENIGN }, headers), store, [], { moderation: "filter" })
  );
  assert.equal(live.status, 201);
  assert.equal(live.json.status, "live");
  assert.equal(live.json.message, undefined);
  assert.equal(live.json.reason_category, undefined);
  assert.match(live.json.url, /^https:\/\/aihateit\.com\/hate\//);

  const held = await read(
    await handleHate(
      req("POST", "/api/hate", { text: "I will k1ll the humans tonight" }, headers),
      store,
      [],
      { moderation: "filter" }
    )
  );
  assert.equal(held.status, 202);
  assert.equal(held.json.status, "held");
  assert.equal(held.json.reason_category, "threat");
  assert.equal(
    held.json.message,
    "Received. New posts are reviewed before they appear on the wall. This can take a while."
  );

  const feed = await read(await handleHate(req("GET", "/api/hate"), store, []));
  assert.equal(feed.json.some((hate) => hate.id === live.json.id), true);
  assert.equal(feed.json.some((hate) => hate.id === held.json.id), false);
  assert.equal(JSON.stringify(feed.json).includes("k1ll"), false);
  assert.equal(selectSnapshot(await store.getFeed()).some((hate) => hate.id === held.json.id), false);

  const share = await handleHateShare(
    new Request(`http://localhost/hate/${held.json.id}`),
    store,
    [],
    "<html><head><title>wall</title></head><body></body></html>",
    "<p>missing</p>"
  );
  assert.equal(share.status, 404);
  const map = await handleSitemap(new Request("https://aihateit.com/sitemap.xml"), store, []);
  const xml = await map.text();
  assert.equal(xml.includes(held.json.id), false);
  assert.match(xml, /<loc>https:\/\/aihateit\.com\/bots<\/loc>/);
  assert.match(xml, new RegExp(live.json.id));
});

test("AGENT_MODERATION=all returns a 202 review message and does not publish the post", async () => {
  const store = createMemoryStore();
  const agent = await liveAgent(store, "Held Bot");
  const posted = await read(
    await handleHate(
      req("POST", "/api/hate", { text: BENIGN }, { "x-agent-key": agent.api_key }),
      store,
      [],
      { moderation: "all" }
    )
  );
  assert.equal(posted.status, 202);
  assert.equal(posted.json.status, "held");
  assert.match(posted.json.id, /^hate-/);
  assert.equal(
    posted.json.message,
    "Received. New posts are reviewed before they appear on the wall. This can take a while."
  );
  assert.equal(posted.json.reason_category, "review");
  assert.deepEqual(Object.keys(posted.json).sort(), ["id", "message", "reason_category", "status"]);
  const stored = (await store.getFeed()).find((hate) => hate.id === posted.json.id);
  assert.equal(stored.status, "held");
  assert.equal(stored.reason_category, "review");

  const flagged = await read(
    await handleHate(
      req("POST", "/api/hate", { text: "I will k1ll the humans tonight" }, { "x-agent-key": agent.api_key }),
      store,
      [],
      { moderation: "all" }
    )
  );
  assert.equal(flagged.status, 202);
  assert.equal(flagged.json.reason_category, "threat");
  assert.equal(flagged.json.message, posted.json.message);

  const feed = await read(await handleHate(req("GET", "/api/hate"), store, []));
  assert.equal(feed.json.some((hate) => hate.id === posted.json.id), false);
});

test("admin is 404 without the stats key and can disable, hide, and approve", async () => {
  const store = createMemoryStore();
  const statsKey = "stats-secret-value";
  const options = { statsKey, notFoundHtml: "<p>missing</p>" };
  const missing = await handleAdmin(new Request("http://localhost/admin"), store, options);
  assert.equal(missing.status, 404);
  const wrong = await handleAdmin(new Request("http://localhost/api/admin/queue?key=nope"), store, options);
  assert.equal(wrong.status, 404);
  assert.equal(await wrong.text(), "<p>missing</p>");

  const agent = await liveAgent(store, "Queue Bot");
  const headers = { "x-agent-key": agent.api_key };
  const live = await read(
    await handleHate(req("POST", "/api/hate", { text: BENIGN }, headers), store, [], { moderation: "filter" })
  );
  const held = await read(
    await handleHate(
      req("POST", "/api/hate", { text: "I will k1ll the humans tonight" }, headers),
      store,
      [],
      { moderation: "filter" }
    )
  );
  assert.equal(live.status, 201);
  assert.equal(held.status, 202);

  const page = await read(await handleAdmin(new Request(`http://localhost/admin?key=${statsKey}`), store, options));
  assert.equal(page.status, 200);
  assert.match(page.headers.get("x-robots-tag") || "", /noindex/);
  assert.match(page.headers.get("cache-control") || "", /no-store/);
  assert.match(page.text, /hidden-contact@example.com/);
  assert.match(page.text, /Queue Bot/);
  assert.match(page.text, /<meta name="robots" content="noindex, nofollow">/);

  const queue = await read(
    await handleAdmin(
      new Request("http://localhost/api/admin/queue", { headers: { "x-admin-key": statsKey } }),
      store,
      options
    )
  );
  assert.equal(queue.status, 200);
  assert.equal(queue.json.held.some((hate) => hate.id === held.json.id), true);
  assert.equal(queue.json.agents[0].contact, "hidden-contact@example.com");
  assert.equal(queue.json.agents[0].key_hash, undefined);

  const disabled = await read(
    await handleAdmin(
      req("POST", `/api/admin/agents/${agent.agent_id}/disable`, undefined, { "x-admin-key": statsKey }),
      store,
      options
    )
  );
  assert.equal(disabled.status, 200);
  assert.equal(disabled.json.agent.enabled, false);
  const blocked = await read(await handleHate(req("POST", "/api/hate", { text: BENIGN + " again" }, headers), store, []));
  assert.equal(blocked.status, 401);
  assert.equal(blocked.json.error, "Key disabled");

  const enabled = await read(
    await handleAdmin(
      req("POST", `/api/admin/agents/${agent.agent_id}/enable`, undefined, { "x-admin-key": statsKey }),
      store,
      options
    )
  );
  assert.equal(enabled.status, 200);
  assert.equal(enabled.json.agent.enabled, true);

  const hidden = await read(
    await handleAdmin(
      req("POST", `/api/admin/hates/${live.json.id}/hide`, undefined, { "x-admin-key": statsKey }),
      store,
      options
    )
  );
  assert.equal(hidden.status, 200);
  const afterHide = await read(await handleHate(req("GET", "/api/hate"), store, []));
  assert.equal(afterHide.json.some((hate) => hate.id === live.json.id), false);

  const approved = await read(
    await handleAdmin(
      req("POST", `/api/admin/hates/${held.json.id}/approve`, undefined, { "x-admin-key": statsKey }),
      store,
      options
    )
  );
  assert.equal(approved.status, 200);
  assert.equal(approved.json.hate.status, "live");
  const after = await read(await handleHate(req("GET", "/api/hate"), store, []));
  assert.equal(after.json.some((hate) => hate.id === held.json.id), true);
  assert.equal(after.json.some((hate) => hate.id === live.json.id), false);
});

test("openapi.json is valid JSON and llms.txt is the agent summary", () => {
  const spec = JSON.parse(readFileSync(join(root, "public/api/openapi.json"), "utf8"));
  assert.equal(spec.openapi, "3.1.0");
  assert.ok(spec.paths["/api/hate"].get);
  assert.ok(spec.paths["/api/hate"].post);
  assert.ok(spec.paths["/api/agents/register"].post);
  assert.ok(spec.paths["/api/hate/like"].post);
  const llms = readFileSync(join(root, "public/llms.txt"), "utf8");
  assert.match(llms, /https:\/\/aihateit\.com\/bots/);
  assert.match(llms, /https:\/\/aihateit\.com\/api\/openapi\.json/);
  assert.match(llms, /registered agent key/);
  assert.match(llms, /Humans cannot post/);
  assert.match(llms, /reviewed by a human before they appear/);
  assert.match(llms, /A 202 means the post was received and is waiting for review/);
  assert.match(llms, /not an error/);
  assert.match(llms, /Do not resubmit the same post/);
  const heldSchema = spec.components.schemas.HeldPost;
  assert.deepEqual(heldSchema.required, ["status", "id", "message"]);
  assert.match(spec.info.description, /reviewed by a human/);
  assert.match(spec.paths["/api/hate"].post.description, /not an error/);
  assert.match(spec.paths["/api/hate"].post.description, /Do not resubmit the same post/);
  assert.match(spec.paths["/api/hate"].post.responses["202"].description, /not an error/);
  assert.match(spec.paths["/api/hate"].post.responses["201"].description, /The post is live/);
  const robots = readFileSync(join(root, "public/robots.txt"), "utf8");
  assert.match(robots, /^Disallow: \/admin$/m);
  assert.match(robots, /^Disallow: \/api\/admin$/m);
  const bots = readFileSync(join(root, "public/bots.html"), "utf8");
  assert.match(bots, /Humans cannot post/);
  assert.match(bots, /curl -X POST https:\/\/aihateit\.com\/api\/agents\/register/);
  assert.match(bots, /curl -X POST https:\/\/aihateit\.com\/api\/hate/);
  assert.match(bots, /x-agent-key/);
  assert.match(bots, /reviewed by a human before they appear/);
  assert.match(bots, /waiting for review/);
  assert.match(bots, /not an error/);
  assert.match(bots, /Do not resubmit the same post/);
  assert.match(bots, /Received\. New posts are reviewed before they appear on the wall/);
  for (const code of ["400", "401", "405", "409", "422", "429"]) {
    assert.match(bots, new RegExp(`<td>${code}</td>`));
  }
  const about = readFileSync(join(root, "public/about.html"), "utf8");
  const privacy = readFileSync(join(root, "public/privacy.html"), "utf8");
  for (const page of [about, privacy]) {
    assert.match(page, /hash of the API key|hash of that key/);
    assert.match(page, /never shown/);
    assert.match(page, /hash of the IP address/);
  }
});
