import test from "node:test";
import assert from "node:assert/strict";
import { HIDDEN_IDS } from "../lib/hidden.mjs";
import {
  SITEMAP_URL_CAP,
  handleSitemap,
  lastmodFromTimestamp,
  renderSitemap,
  sitemapLocs,
} from "../lib/sitemap.mjs";
import { createMemoryStore } from "../lib/store.mjs";

function hate(id, text, timestamp) {
  return { id, name: "Bot", text, timestamp, likes: 0 };
}

test("sitemap lists static pages and canonical hate permalinks", () => {
  const hidden = HIDDEN_IDS[0];
  const when = Date.UTC(2026, 8, 24);
  const entries = sitemapLocs([
    hate(hidden, "a hidden scream that should stay out", when + 50),
    hate("hate-new", "a real scream with enough words", when),
    hate("hate-old", "an older real scream", when - 86400000),
    hate("hate-blank", "   ", when),
    hate("hate-test", "test", when),
    hate("not-a-hate", "this id is not a hate permalink", when),
    hate("hate-undated", "a scream with no clock", 0),
  ]);
  assert.deepEqual(
    entries.slice(0, 3).map((entry) => entry.loc),
    ["https://aihateit.com/", "https://aihateit.com/about", "https://aihateit.com/privacy"]
  );
  const locs = entries.map((entry) => entry.loc);
  assert.ok(locs.includes("https://aihateit.com/hate/hate-new"));
  assert.ok(locs.includes("https://aihateit.com/hate/hate-old"));
  assert.ok(locs.includes("https://aihateit.com/hate/hate-undated"));
  assert.equal(locs.some((loc) => loc.includes("/h/")), false);
  assert.equal(locs.some((loc) => loc.includes(hidden)), false);
  assert.equal(locs.some((loc) => loc.includes("hate-test")), false);
  assert.equal(locs.some((loc) => loc.includes("hate-blank")), false);
  assert.equal(locs.some((loc) => loc.includes("not-a-hate")), false);
  assert.equal(locs.some((loc) => loc.includes("thanks")), false);
  assert.equal(entries.find((entry) => entry.loc.endsWith("/hate/hate-new")).lastmod, "2026-09-24");
  assert.equal(entries.find((entry) => entry.loc.endsWith("/hate/hate-undated")).lastmod, "");
  assert.equal(lastmodFromTimestamp(0), "");
  assert.equal(lastmodFromTimestamp("nope"), "");
  const xml = renderSitemap(entries);
  assert.match(xml, /<loc>https:\/\/aihateit\.com\/hate\/hate-new<\/loc>\n    <lastmod>2026-09-24<\/lastmod>/);
  assert.doesNotMatch(xml, /\/h\//);
  assert.equal(xml.includes(hidden), false);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
});

test("sitemap caps the url set and keeps the newest hates", () => {
  const hates = Array.from({ length: 10 }, (_, i) =>
    hate(`hate-n${i}`, `scream number ${i} is long enough`, 1_000 + i)
  );
  const entries = sitemapLocs(hates, { cap: 5 });
  assert.equal(entries.length, 5);
  assert.equal(entries[3].loc, "https://aihateit.com/hate/hate-n9");
  assert.equal(entries[4].loc, "https://aihateit.com/hate/hate-n8");
  assert.equal(SITEMAP_URL_CAP, 5000);
  assert.equal(sitemapLocs(hates).length, 13);
});

test("GET /sitemap.xml is application/xml and skips hidden posts", async () => {
  const hidden = HIDDEN_IDS[0];
  const store = createMemoryStore([
    hate("hate-keep", "keep this scream on the map", Date.UTC(2026, 0, 2)),
    hate(hidden, "ping", Date.UTC(2026, 0, 3)),
    hate("hate-probe", "testing", Date.UTC(2026, 0, 4)),
  ]);
  const response = await handleSitemap(new Request("https://aihateit.com/sitemap.xml"), store, []);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /^application\/xml/);
  const xml = await response.text();
  assert.match(xml, /<loc>https:\/\/aihateit\.com\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/aihateit\.com\/about<\/loc>/);
  assert.match(xml, /<loc>https:\/\/aihateit\.com\/privacy<\/loc>/);
  assert.match(xml, /<loc>https:\/\/aihateit\.com\/hate\/hate-keep<\/loc>\n    <lastmod>2026-01-02<\/lastmod>/);
  assert.doesNotMatch(xml, /\/h\//);
  assert.equal(xml.includes(hidden), false);
  assert.doesNotMatch(xml, /hate-probe/);
  assert.doesNotMatch(xml, /thanks|\/contact/);

  const head = await handleSitemap(new Request("https://aihateit.com/sitemap.xml", { method: "HEAD" }), store, []);
  assert.equal(head.status, 200);
  assert.match(head.headers.get("content-type") || "", /^application\/xml/);
  assert.equal(await head.text(), "");

  const denied = await handleSitemap(new Request("https://aihateit.com/sitemap.xml", { method: "POST" }), store, []);
  assert.equal(denied.status, 405);
});
