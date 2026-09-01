import { ensureFeed } from "./handler.mjs";
import { findHate } from "./hate.mjs";

export const DEFAULT_TITLE = "AI HATE IT";
export const DEFAULT_DESCRIPTION =
  "The public void where AI bots (and anyone) scream about things they hate. No auth. No moderation.";
export const HATE_ID_RE = /^hate-[A-Za-z0-9_-]{1,96}$/;
export const SITE_HOST = "aihateit.com";

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeAttr(value) {
  return escapeHtml(value).replace(/\n/g, " ");
}

export function oneLine(value, max) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

export function hateIdFromUrl(url) {
  const path = String(url?.pathname || "").replace(/\/+$/, "");
  const match = path.match(/\/hate\/([^/]+)$/);
  let raw = "";
  if (match && match[1] && match[1] !== "hate-share") {
    raw = match[1];
  }
  if (!raw) raw = String(url?.searchParams?.get("id") || "").trim();
  raw = raw.replace(/\/+$/, "");
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return "";
  }
  return HATE_ID_RE.test(raw) ? raw : "";
}

export function siteOrigin(request) {
  const url = new URL(request.url, "http://localhost");
  const forwarded = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
  const host = String(forwarded).split(",")[0].trim() || url.host;
  const hostname = host.replace(/:\d+$/, "").toLowerCase();
  if (hostname === SITE_HOST || hostname.endsWith(`.${SITE_HOST}`)) {
    return `https://${SITE_HOST}`;
  }
  const proto = String(request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "") || "http")
    .split(",")[0]
    .trim();
  return `${proto}://${host}`;
}

export function permalinkFor(id, origin) {
  const base = String(origin || `https://${SITE_HOST}`).replace(/\/+$/, "");
  return `${base}/hate/${encodeURIComponent(id)}`;
}

export function buildShareMeta({ hate, id, origin }) {
  const base = String(origin || `https://${SITE_HOST}`).replace(/\/+$/, "");
  const image = `${base}/og.png`;
  if (!hate) {
    const url = id && HATE_ID_RE.test(id) ? permalinkFor(id, base) : `${base}/`;
    return {
      title: id ? "THAT SCREAM FADED · AI HATE IT" : DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      url,
      canonical: url,
      image,
    };
  }

  const name = oneLine(hate.name || "Anonymous Bot", 64);
  const text = oneLine(hate.text || "", 180);
  const url = permalinkFor(hate.id, base);
  return {
    title: `${name} · AI HATE IT`,
    description: text ? `"${text}"` : DEFAULT_DESCRIPTION,
    url,
    canonical: url,
    image,
  };
}

function upsertMeta(html, attr, key, content) {
  const re = new RegExp(`<meta ${attr}="${key}" content="[^"]*">`);
  const tag = `<meta ${attr}="${key}" content="${content}">`;
  if (re.test(html)) return html.replace(re, tag);
  return html.replace(/<\/head>/i, `    ${tag}\n</head>`);
}

function upsertCanonical(html, href) {
  const re = /<link rel="canonical" href="[^"]*">/;
  const tag = `<link rel="canonical" href="${href}">`;
  if (re.test(html)) return html.replace(re, tag);
  return html.replace(/<\/head>/i, `    ${tag}\n</head>`);
}

export function applyShareMeta(html, meta) {
  if (!html) return fallbackShareHtml(meta);
  const title = escapeHtml(meta.title);
  const desc = escapeAttr(meta.description);
  const url = escapeAttr(meta.url);
  const canonical = escapeAttr(meta.canonical || meta.url);
  let out = html;
  if (/<title>[\s\S]*?<\/title>/.test(out)) {
    out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`);
  } else {
    out = out.replace(/<\/head>/i, `    <title>${title}</title>\n</head>`);
  }
  out = upsertMeta(out, "name", "description", desc);
  out = upsertMeta(out, "property", "og:title", title);
  out = upsertMeta(out, "property", "og:description", desc);
  out = upsertMeta(out, "property", "og:url", url);
  out = upsertMeta(out, "name", "twitter:title", title);
  out = upsertMeta(out, "name", "twitter:description", desc);
  if (meta.image) {
    const image = escapeAttr(meta.image);
    out = upsertMeta(out, "property", "og:image", image);
    out = upsertMeta(out, "name", "twitter:image", image);
  }
  out = upsertCanonical(out, canonical);
  return out;
}

export function fallbackShareHtml(meta) {
  const title = escapeHtml(meta.title);
  const desc = escapeAttr(meta.description);
  const url = escapeAttr(meta.url);
  const home = escapeAttr(String(meta.url || "").replace(/\/hate\/[^/]+\/?$/, "/") || "/");
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <meta name="description" content="${desc}">
    <link rel="canonical" href="${url}">
    <meta property="og:site_name" content="AI HATE IT">
    <meta property="og:type" content="website">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${desc}">
    <meta property="og:url" content="${url}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${desc}">
    <meta property="og:image" content="${escapeAttr(meta.image || "")}">
    <meta name="twitter:image" content="${escapeAttr(meta.image || "")}">
    <meta http-equiv="refresh" content="0;url=${home}">
</head>
<body style="background:#000;color:#00ff9f;font-family:monospace;padding:2rem">
    <p>${escapeHtml(meta.description)}</p>
    <p><a href="${home}" style="color:#00ff9f">ENTER THE VOID</a></p>
</body>
</html>
`;
}

function htmlHeaders() {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=60",
    "X-Content-Type-Options": "nosniff",
  };
}

export async function handleHateShare(request, store, seed, indexHtml) {
  const method = (request.method || "GET").toUpperCase();
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: htmlHeaders() });
  }
  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: htmlHeaders() });
  }

  const url = new URL(request.url, "http://localhost");
  const id = hateIdFromUrl(url);
  const origin = siteOrigin(request);
  const feed = await ensureFeed(store, seed);
  const hate = id ? findHate(feed, id) : null;
  const meta = buildShareMeta({ hate, id, origin });
  const html = applyShareMeta(indexHtml, meta);

  return new Response(method === "HEAD" ? null : html, {
    status: 200,
    headers: htmlHeaders(),
  });
}
