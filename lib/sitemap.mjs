import { ensureFeed } from "./handler.mjs";
import { normalizeHate, sortNewest } from "./hate.mjs";
import { isJunkText, visibleHates } from "./hidden.mjs";

export const SITEMAP_URL_CAP = 5000;
export const SITEMAP_ORIGIN = "https://aihateit.com";

const HATE_ID_RE = /^hate-[A-Za-z0-9_-]{1,96}$/;
const STATIC_PATHS = ["/", "/about", "/privacy"];

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function lastmodFromTimestamp(timestamp) {
  const n = Number(timestamp);
  if (!Number.isFinite(n) || n <= 0) return "";
  const date = new Date(n);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function sitemapLocs(hates, { cap = SITEMAP_URL_CAP, origin = SITEMAP_ORIGIN } = {}) {
  const base = String(origin || SITEMAP_ORIGIN).replace(/\/+$/, "");
  const pages = STATIC_PATHS.map((path) => ({
    loc: path === "/" ? `${base}/` : `${base}${path}`,
    lastmod: "",
  }));
  const posts = sortNewest(
    visibleHates(hates)
      .map((hate) => normalizeHate(hate))
      .filter((hate) => HATE_ID_RE.test(hate.id) && hate.text.trim() && !isJunkText(hate.text))
  ).map((hate) => ({
    loc: `${base}/hate/${encodeURIComponent(hate.id)}`,
    lastmod: lastmodFromTimestamp(hate.timestamp),
  }));
  const room = Math.max(0, Number(cap) - pages.length);
  return [...pages, ...posts.slice(0, Math.max(0, room))];
}

export function renderSitemap(entries) {
  const body = (entries || [])
    .map((entry) => {
      const lastmod = entry.lastmod ? `\n    <lastmod>${escapeXml(entry.lastmod)}</lastmod>` : "";
      return `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>${lastmod}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function xmlHeaders() {
  return {
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
  };
}

export async function handleSitemap(request, store, seed = []) {
  const method = (request.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const feed = visibleHates(await ensureFeed(store, seed));
  const xml = renderSitemap(sitemapLocs(feed));
  return new Response(method === "HEAD" ? null : xml, {
    status: 200,
    headers: xmlHeaders(),
  });
}
