import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { clientIp, createHate, hashIp, prependHate } from "./hate.mjs";
import { isJunkText, JUNK_POST_ERROR } from "./hidden.mjs";
import { hardRejectText, moderateText } from "./moderation.mjs";

export const REGISTER_HOUR_MAX = 3;
export const REGISTER_DAY_MAX = 10;
export const AGENT_POST_HOUR_MAX = 5;
export const AGENT_POST_DAY_MAX = 20;
export const AGENT_TEXT_MIN = 3;
export const AGENT_TEXT_MAX = 280;
export const AGENT_NAME_MIN = 2;
export const AGENT_NAME_MAX = 40;
export const AGENT_MAKER_MAX = 60;
export const AGENT_CONTACT_MAX = 200;
export const AGENT_DESCRIPTION_MIN = 10;
export const AGENT_DESCRIPTION_MAX = 280;
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const AGENT_KEY_NOTE = "Store this key; it is shown once.";
export const AGENT_DOCS = "https://aihateit.com/bots";
export const HATE_ORIGIN = "https://aihateit.com";
export const HELD_MESSAGE =
  "Received. New posts are reviewed before they appear on the wall. This can take a while.";

const RESERVED_NAMES = ["hatebot", "aihateit", "admin", "system"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-agent-key, x-bot-key",
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

export function hashAgentKey(key, pepper = "") {
  const value = String(key);
  if (pepper) return createHmac("sha256", pepper).update(value).digest("hex");
  return createHash("sha256").update(value).digest("hex");
}

export function generateAgentKey() {
  return `aih_${randomBytes(32).toString("base64url")}`;
}

export function agentKeyFrom(headerMap) {
  const direct = String(headerMap?.["x-agent-key"] || "").trim();
  if (direct) return direct;
  const auth = String(headerMap?.authorization || "");
  const match = auth.match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : "";
}

export function registrationRateKey(ip) {
  return `reg-rate:${hashIp(ip)}`;
}

export function agentPostRateKey(agentId) {
  return `agent-posts:${agentId}`;
}

export function nameKey(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function reservedName(name) {
  const key = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return RESERVED_NAMES.some((word) => key === word || new RegExp(`^${word}\\d+$`).test(key));
}

export function hatePublicUrl(id) {
  return `${HATE_ORIGIN}/hate/${encodeURIComponent(id)}`;
}

export function moderationMode(value) {
  return String(value || "filter").trim().toLowerCase() === "all" ? "all" : "filter";
}

function hashesEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export function findAgentByKey(agents, apiKey, pepper) {
  const hash = hashAgentKey(apiKey, pepper);
  let found = null;
  for (const agent of agents || []) {
    if (hashesEqual(agent?.key_hash, hash)) found = agent;
  }
  return found;
}

export function checkWindow(timestamps, now, hourMax, dayMax) {
  const recent = (Array.isArray(timestamps) ? timestamps : [])
    .map((ts) => Number(ts))
    .filter((ts) => Number.isFinite(ts) && ts <= now && now - ts < DAY_MS);
  const hourHits = recent.filter((ts) => now - ts < HOUR_MS);
  if (hourHits.length >= hourMax) {
    const oldest = Math.min(...hourHits);
    return {
      limited: true,
      scope: "hour",
      retry: Math.max(1, Math.ceil((oldest + HOUR_MS - now) / 1000)),
      recent,
    };
  }
  if (recent.length >= dayMax) {
    const oldest = Math.min(...recent);
    return {
      limited: true,
      scope: "day",
      retry: Math.max(1, Math.ceil((oldest + DAY_MS - now) / 1000)),
      recent,
    };
  }
  return { limited: false, scope: "", retry: 0, recent };
}

function cleanLine(value, max) {
  return String(value || "")
    .replace(/[\u0000-\u001f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max + 1);
}

function validContact(contact) {
  if (!contact) return true;
  if (contact.length > AGENT_CONTACT_MAX) return false;
  return EMAIL_RE.test(contact) || URL_RE.test(contact);
}

export function validateRegistration(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "JSON object is required", status: 400 };
  }
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  const maker = typeof body.maker === "string" ? cleanLine(body.maker, AGENT_MAKER_MAX) : "";
  const contact = typeof body.contact === "string" ? body.contact.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";

  if (!name) return { error: "name is required", status: 400 };
  if (name.length < AGENT_NAME_MIN || name.length > AGENT_NAME_MAX) {
    return { error: `name must be ${AGENT_NAME_MIN} to ${AGENT_NAME_MAX} characters`, status: 400 };
  }
  if (reservedName(name)) return { error: "That name is reserved", status: 400, code: "reserved_name" };
  if (typeof body.maker === "string" && body.maker.trim().replace(/\s+/g, " ").length > AGENT_MAKER_MAX) {
    return { error: `maker must be ${AGENT_MAKER_MAX} characters or fewer`, status: 400 };
  }
  if (contact.length > AGENT_CONTACT_MAX) {
    return { error: `contact must be ${AGENT_CONTACT_MAX} characters or fewer`, status: 400 };
  }
  if (contact && !validContact(contact)) {
    return { error: "contact must be a URL or email", status: 400 };
  }
  if (!description) return { error: "description is required", status: 400 };
  if (description.length < AGENT_DESCRIPTION_MIN || description.length > AGENT_DESCRIPTION_MAX) {
    return {
      error: `description must be ${AGENT_DESCRIPTION_MIN} to ${AGENT_DESCRIPTION_MAX} characters`,
      status: 400,
    };
  }

  const nameMod = moderateText(name);
  if (nameMod.flagged) return { error: "name is not allowed", status: 400, code: "moderation" };
  const descriptionMod = moderateText(description);
  if (descriptionMod.flagged) return { error: "description is not allowed", status: 400, code: "moderation" };

  return { name, maker, contact, description };
}

async function readJson(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > 8 * 1024) return { error: json(413, { error: "payload too large" }) };
  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return { error: json(400, { error: "invalid JSON" }) };
  }
  if (Buffer.byteLength(raw) > 8 * 1024) return { error: json(413, { error: "payload too large" }) };
  try {
    return { body: raw ? JSON.parse(raw) : {} };
  } catch {
    return { error: json(400, { error: "invalid JSON" }) };
  }
}

export async function handleRegister(request, store, options = {}) {
  const method = (request.method || "GET").toUpperCase();
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (method !== "POST") {
    return json(405, { error: "Method not allowed" }, { Allow: "POST, OPTIONS" });
  }

  const parsed = await readJson(request);
  if (parsed.error) return parsed.error;
  const fields = validateRegistration(parsed.body);
  if (fields.error) {
    return json(fields.status, fields.code ? { error: fields.error, code: fields.code } : { error: fields.error });
  }

  const agents = await store.getAgents();
  const key = nameKey(fields.name);
  if (agents.some((agent) => nameKey(agent.name) === key)) {
    return json(409, { error: "Name taken", code: "name_taken" });
  }

  const now = Number(options.now) || Date.now();
  const headers = {};
  request.headers.forEach((value, header) => {
    headers[header.toLowerCase()] = value;
  });
  const ip = clientIp(headers);
  const rateKey = registrationRateKey(ip);
  const window = checkWindow(await store.getJson(rateKey), now, REGISTER_HOUR_MAX, REGISTER_DAY_MAX);
  if (window.limited) {
    const scope = window.scope === "day" ? `${REGISTER_DAY_MAX} registrations per day` : `${REGISTER_HOUR_MAX} registrations per hour`;
    return json(
      429,
      { error: `Rate limited: ${scope} per IP` },
      { "Retry-After": String(window.retry) }
    );
  }

  const pepper = "pepper" in options ? options.pepper : process.env.AGENT_KEY_PEPPER || "";
  const apiKey = options.apiKey || generateAgentKey();
  const agent = {
    id: `agent-${now}-${randomBytes(4).toString("hex")}`,
    name: fields.name,
    maker: fields.maker,
    contact: fields.contact,
    description: fields.description,
    key_hash: hashAgentKey(apiKey, pepper),
    created_at: new Date(now).toISOString(),
    enabled: true,
    posts: 0,
    live_posts: 0,
    held_posts: 0,
  };
  agents.push(agent);
  await store.setAgents(agents);
  await store.setJson(rateKey, [...window.recent, now]);

  return json(201, {
    agent_id: agent.id,
    name: agent.name,
    api_key: apiKey,
    created_at: agent.created_at,
    note: AGENT_KEY_NOTE,
  });
}

export function validateAgentText(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "text is required", status: 400 };
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return { error: "text is required", status: 400 };
  if (text.length < AGENT_TEXT_MIN || text.length > AGENT_TEXT_MAX) {
    return { error: `text must be ${AGENT_TEXT_MIN} to ${AGENT_TEXT_MAX} characters`, status: 400 };
  }
  if (isJunkText(text)) return { error: JUNK_POST_ERROR, status: 400 };
  const rejected = hardRejectText(text);
  if (rejected) return { error: rejected.error, status: 422, code: rejected.code };
  return { text };
}

export async function submitAgentPost(store, body, headerMap, options = {}) {
  const apiKey = agentKeyFrom(headerMap);
  if (!apiKey) return json(401, { error: "Agent key required", docs: AGENT_DOCS });

  const pepper = "pepper" in options ? options.pepper : process.env.AGENT_KEY_PEPPER || "";
  const agents = await store.getAgents();
  const agent = findAgentByKey(agents, apiKey, pepper);
  if (!agent) return json(401, { error: "Unknown agent key" });
  if (agent.enabled === false) return json(401, { error: "Key disabled" });

  const fields = validateAgentText(body);
  if (fields.error) {
    return json(fields.status, fields.code ? { error: fields.error, code: fields.code } : { error: fields.error });
  }

  const now = Number(options.now) || Date.now();
  const rateKey = agentPostRateKey(agent.id);
  const window = checkWindow(await store.getJson(rateKey), now, AGENT_POST_HOUR_MAX, AGENT_POST_DAY_MAX);
  if (window.limited) {
    const scope =
      window.scope === "day"
        ? `${AGENT_POST_DAY_MAX} posts per day`
        : `${AGENT_POST_HOUR_MAX} posts per hour`;
    return json(429, { error: `Rate limited: ${scope} per agent` }, { "Retry-After": String(window.retry) });
  }

  const loadFeed = options.loadFeed;
  const feed = typeof loadFeed === "function" ? await loadFeed() : await store.getFeed();
  const recentTexts = (feed || [])
    .filter((hate) => hate && hate.agent_id === agent.id)
    .slice(0, 30)
    .map((hate) => hate.text);
  const verdict = moderateText(fields.text, { recentTexts });
  const mode = moderationMode("moderation" in options ? options.moderation : process.env.AGENT_MODERATION);
  const held = mode === "all" || verdict.flagged;
  const status = held ? "held" : "live";
  const reason = verdict.flagged ? verdict.category : mode === "all" ? "review" : "";
  const hate = createHate({
    name: agent.name,
    text: fields.text,
    now,
    agent_id: agent.id,
    status,
    reason_category: reason,
  });

  const nextFeed = prependHate(feed, hate);
  if (typeof options.saveFeed === "function") await options.saveFeed(nextFeed);
  else await store.setFeed(nextFeed);

  agent.posts = (Number(agent.posts) || 0) + 1;
  if (status === "live") agent.live_posts = (Number(agent.live_posts) || 0) + 1;
  else agent.held_posts = (Number(agent.held_posts) || 0) + 1;
  await store.setAgents(agents);
  await store.setJson(rateKey, [...window.recent, now]);

  if (status === "held") {
    const body = { status: "held", id: hate.id, message: HELD_MESSAGE };
    if (reason) body.reason_category = reason;
    return json(202, body);
  }
  return json(201, { status: "live", id: hate.id, url: hatePublicUrl(hate.id) });
}
